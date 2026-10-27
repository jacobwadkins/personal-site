// Canoe river game on the Personal page: paddle down a Blue Ridge river and go ashore at the landing
// for each page. three.js loads from a CDN only once the section nears the screen; everything in the
// scene (terrain, forest, water, sky, buildings, canoe) is generated here, so there are no asset files.
(function () {
    "use strict";

    const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.186.1/+esm";

    // Landings in the order you reach them. The river flows toward -z: z is where the landing sits and
    // side is the bank it's on (-1 river left, 1 river right).
    const STOPS = [
        {
            name: "Interests", href: "Interests.html", place: "Riverside campsite", z: -70, side: -1, build: "camp",
            blurb: "Pull up at the campsite to see what I get up to when I'm off the clock."
        },
        {
            name: "Travels", href: "Travels.html", place: "Trailhead shelter", z: -170, side: 1, build: "trail",
            blurb: "Every trip starts at a trailhead. Here's where mine have gone."
        },
        {
            name: "Quotes", href: "Quotes.html", place: "Old grist mill", z: -270, side: -1, build: "mill"
            // shows one of QUOTES instead of a blurb
        },
        {
            name: "Contact", href: "Contact.html", place: "Cabin landing", z: -370, side: 1, build: "cabin",
            blurb: "The porch light's on. Stop in and say hello."
        }
    ];

    // A few of the shorter lines from Quotes.html; the mill landing shows one at random
    const QUOTES = [
        ["Never let the fear of striking out keep you from playing the game.", "Babe Ruth"],
        ["I believe it is in our nature to explore, to reach out into the unknown. The only true failure would be not to explore at all.", "Ernest Shackleton"],
        ["One day, in retrospect, the years of struggle will strike you as the most beautiful.", "Sigmund Freud"],
        ["The cave you fear to enter holds the treasure you seek.", "Joseph Campbell"],
        ["Far and away the best prize life has to offer is the chance to work hard at work worth doing.", "Teddy Roosevelt"],
        ["Rarely have I seen a situation where doing less than the other guy is a good strategy.", "Jimmy Spithill"]
    ];

    const RIVER = { start: 30, end: -470, zMax: 320, zMin: -800 };
    const RIFFLES = [-20, -120, -220, -320, -420]; // shallow, fast stretches between the landings
    const CURRENT = 1.65;    // m/s down the middle of the river, faster through the riffles
    const PAD_HEIGHT = 1.0;  // ground level of each landing's clearing
    const DOCK_Y = 0.7;      // dock deck height above the water
    const CANOE_LEN = 4.9;
    const PADDLER_Z = 1.47;  // the stern seat, in the canoe's frame (bow toward -z)
    const STOP_RANGE = 24;   // how close to a dock before its card appears
    const IDLE_DELAY = 5;    // seconds without paddling before the canoe drifts back to the middle
    const BOOST_DELAY = 3;   // seconds of holding paddle before the paddler digs in and the canoe goes twice as fast
    const TRIP_KEY = "canoeRiver"; // sessionStorage: the landing you went ashore at, to pick the trip back up

    // Fall foliage, shared by the instanced trees and the canopy shading on the far hillsides
    const LEAVES = {
        green: ["#566c31", "#62783a", "#4b6230"],
        yellow: ["#b9993c", "#c6a548", "#a98a30"],
        orange: ["#b9672c", "#ad5b28", "#c47436"],
        red: ["#94412b", "#853727", "#a24b31"],
        brown: ["#7f5e37", "#705735"],
        evergreen: ["#2c4630", "#304d33", "#283f2d"]
    };

    // ---------- math, random numbers, noise ----------

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smoothstep(e0, e1, v) { const t = clamp((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
    // Frame-rate independent easing toward a target
    function damp(current, target, rate, dt) { return lerp(current, target, 1 - Math.exp(-rate * dt)); }
    function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

    function makeRng(seed) { // mulberry32
        return function () {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // 2D gradient noise, roughly -1..1
    const PERM = new Uint8Array(512);
    (function () {
        const rng = makeRng(7), p = [];
        for (let i = 0; i < 256; i++) p.push(i);
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1)), t = p[i];
            p[i] = p[j];
            p[j] = t;
        }
        for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
    })();

    function grad(h, x, y) {
        switch (h & 7) {
            case 0: return x + y;
            case 1: return -x + y;
            case 2: return x - y;
            case 3: return -x - y;
            case 4: return x;
            case 5: return -x;
            case 6: return y;
            default: return -y;
        }
    }

    function noise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const X = xi & 255, Y = yi & 255;
        const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
        const a = PERM[X] + Y, b = PERM[X + 1] + Y;
        return lerp(lerp(grad(PERM[a], xf, yf), grad(PERM[b], xf - 1, yf), u),
                    lerp(grad(PERM[a + 1], xf, yf - 1), grad(PERM[b + 1], xf - 1, yf - 1), u), v);
    }

    function fbm(x, y, octaves) {
        let sum = 0, amp = 0.5;
        for (let i = 0; i < octaves; i++) {
            sum += amp * noise(x, y);
            x = x * 2.03 + 17.1;
            y = y * 2.03 + 5.3;
            amp *= 0.5;
        }
        return sum * 1.6;
    }

    // ---------- the river and the valley it runs through ----------

    function riffle(z) {
        let r = 0;
        for (const c of RIFFLES) r = Math.max(r, 1 - smoothstep(12, 34, Math.abs(z - c)));
        return r;
    }
    function riverX(z) {
        return 34 * Math.sin(z * 0.0105 + 0.6) + 15 * Math.sin(z * 0.023 + 2.1) + 5 * Math.sin(z * 0.051 + 0.3);
    }
    function riverSlope(z) { // d(riverX)/dz
        return 0.357 * Math.cos(z * 0.0105 + 0.6) + 0.345 * Math.cos(z * 0.023 + 2.1) + 0.255 * Math.cos(z * 0.051 + 0.3);
    }
    function riverHalfWidth(z) {
        return 11 + 2.5 * Math.sin(z * 0.017 + 1.0) + 1.5 * Math.sin(z * 0.043 + 0.4) - 2 * riffle(z);
    }
    // Signed distance from the centre line, measured across the flow (positive toward +x)
    function riverOffset(x, z) {
        const s = riverSlope(z);
        return (x - riverX(z)) / Math.sqrt(1 + s * s);
    }
    // World position `o` metres across the river from the centre line at z
    function riverPoint(z, o) {
        const s = riverSlope(z), inv = 1 / Math.sqrt(1 + s * s);
        return { x: riverX(z) + o * inv, z: z - o * s * inv };
    }
    // Canoe yaw that points straight downstream at z (forward is (-sin yaw, -cos yaw))
    function riverYaw(z) { return Math.atan2(riverSlope(z), 1); }

    // Each landing sits in a flat clearing 12 m back from the water
    const SITES = STOPS.map(function (stop) {
        const s = riverSlope(stop.z), inv = 1 / Math.sqrt(1 + s * s);
        const c = riverPoint(stop.z, stop.side * (riverHalfWidth(stop.z) + 12));
        const yaw = Math.atan2(-stop.side * inv, stop.side * s * inv); // local +z faces the river
        return { x: c.x, z: c.z, r: 15, yaw: yaw, cos: Math.cos(yaw), sin: Math.sin(yaw) };
    });
    function siteToWorld(site, lx, lz) {
        return { x: site.x + lx * site.cos + lz * site.sin, z: site.z - lx * site.sin + lz * site.cos };
    }
    function padWeight(x, z) {
        let w = 0;
        for (const p of SITES) {
            const dx = x - p.x, dz = z - p.z;
            if (Math.abs(dx) < 25 && Math.abs(dz) < 25) w = Math.max(w, 1 - smoothstep(p.r * 0.7, p.r * 1.35, Math.sqrt(dx * dx + dz * dz)));
        }
        return w;
    }

    function terrainHeight(x, z) {
        const off = riverOffset(x, z);
        const hw = riverHalfWidth(z);
        const u = Math.abs(off) - hw; // distance from the water's edge, negative in the river
        const side = off < 0 ? -1 : 1;
        let h;
        if (u < 0) {
            const deep = (2.3 - 1.6 * riffle(z)) * (0.8 + 0.2 * noise(z * 0.02, side * 3.3));
            h = -0.1 - deep * smoothstep(0, Math.min(7, hw * 0.75), -u) + noise(x * 0.4, z * 0.4) * 0.15;
        } else {
            // a strip of flood plain, then the valley wall climbs into rolling ridges
            const plain = 10 + 12 * (0.5 + 0.5 * noise(z * 0.007 + side * 3.1, side * 7.7));
            const w = Math.max(0, u - plain);
            const wallH = 130 + 60 * noise(x * 0.003 + 11.3, z * 0.003 - 4.1);
            h = 1.4 * smoothstep(0, 4.5, u)
                + 0.5 * noise(x * 0.06, z * 0.06) * smoothstep(2, 10, u)
                + wallH * (1 - Math.exp(-w / 170)) * smoothstep(0, 45, w) + w * 0.1
                + fbm(x * 0.0045, z * 0.0045, 4) * 60 * smoothstep(0, 140, w)
                + fbm(x * 0.021 + 5.2, z * 0.021, 3) * 7 * smoothstep(0, 40, w);
        }
        // the valley closes off past both ends of the run, as if the river bends out of sight
        h += (75 + 25 * noise(x * 0.01, 3.7)) * (smoothstep(RIVER.end - 120, RIVER.end - 300, z) + smoothstep(170, 310, z));
        const pw = padWeight(x, z);
        if (pw > 0) h = lerp(h, PAD_HEIGHT, pw * smoothstep(-1, 1.5, u));
        return h;
    }

    // ---------- page wiring ----------

    const root = document.getElementById("canoe-river");
    if (!root) return;

    // The river fills the screen below the header, which gets taller where its links wrap
    const header = document.querySelector("header");
    if (header && "ResizeObserver" in window) {
        new ResizeObserver(function () {
            root.style.setProperty("--cr-header", header.offsetHeight + "px");
        }).observe(header);
    }

    const stage = root.querySelector(".cr-stage");
    const canvas = stage.querySelector("canvas");
    const statusEl = stage.querySelector(".cr-status");
    const startBtn = stage.querySelector(".cr-start");
    const hud = stage.querySelector(".cr-hud");
    const labelLayer = stage.querySelector(".cr-labels");
    const card = stage.querySelector(".cr-card");
    const toastEl = stage.querySelector(".cr-toast");
    const fadeEl = stage.querySelector(".cr-fade");
    const fsBtn = stage.querySelector(".cr-fs");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    const lowPower = coarse || Math.min(window.screen.width, window.screen.height) < 600 || (navigator.hardwareConcurrency || 8) <= 4;
    let game = null;

    const chips = STOPS.map(function (stop, i) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "cr-chip";
        chip.title = "Skip ahead to the " + stop.name + " landing";
        chip.innerHTML = '<span class="cr-chip-num">' + (i + 1) + "</span>" + stop.name;
        chip.addEventListener("click", function () {
            if (!game) return;
            game.start();
            game.jumpTo(i);
        });
        hud.appendChild(chip);
        return chip;
    });

    const labels = STOPS.map(function (stop, i) {
        const label = document.createElement("div");
        label.className = "cr-label";
        label.innerHTML = '<span class="cr-chip-num">' + (i + 1) + "</span>" + stop.name + '<span class="cr-label-dist"></span>';
        labelLayer.appendChild(label);
        return { el: label, dist: label.querySelector(".cr-label-dist"), shown: "" };
    });

    let toastTimer = 0;
    function toast(message, ms) {
        toastEl.textContent = message;
        toastEl.classList.add("is-visible");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove("is-visible"); }, ms || 4000);
    }

    function escapeHtml(s) {
        return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
    }

    function showStop(i) {
        if (i < 0) {
            card.classList.remove("is-visible");
            return;
        }
        const stop = STOPS[i];
        let body;
        if (stop.blurb) {
            body = '<p class="text-sm text-gray-700">' + stop.blurb + "</p>";
        } else {
            const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
            body = '<blockquote class="text-sm text-gray-700 italic">&ldquo;' + escapeHtml(q[0]) + '&rdquo;</blockquote>' +
                '<p class="text-xs text-gray-500 mt-1">&mdash; ' + escapeHtml(q[1]) + "</p>";
        }
        card.innerHTML =
            '<p class="tt-kicker">Landing ' + (i + 1) + " of " + STOPS.length + " &middot; " + stop.place + "</p>" +
            '<h3 class="cr-card-title">' + stop.name + "</h3>" + body +
            '<p class="mt-3"><a class="cr-ashore" href="' + stop.href + '">Go ashore &rarr;</a>' +
            (coarse ? "" : ' <span class="cr-hint">or press <kbd class="cr-key">E</kbd></span>') + "</p>";
        card.classList.add("is-visible");
        if (game && game.started) {
            chips[i].classList.add("is-visited");
            toast(stop.name + " landing ahead. " + (coarse ? "Tap Go ashore" : "Press E") + " to visit the page.");
        }
    }

    function setFade(on) { fadeEl.classList.toggle("is-on", on); }

    // Going ashore remembers the landing (for this tab only), so coming back puts you in the canoe just
    // off that dock. It's used up on the way back in, so a refresh starts the trip over.
    function saveTrip(i) {
        try {
            sessionStorage.setItem(TRIP_KEY, JSON.stringify({
                stop: i,
                visited: chips.map(function (chip) { return chip.classList.contains("is-visited"); }),
                time: Date.now()
            }));
        } catch (e) { /* storage is blocked; you'll start at the put-in instead */ }
    }
    function takeTrip() {
        try {
            const trip = JSON.parse(sessionStorage.getItem(TRIP_KEY));
            sessionStorage.removeItem(TRIP_KEY);
            if (trip && STOPS[trip.stop] && Date.now() - trip.time < 60 * 60 * 1000) return trip;
        } catch (e) { /* storage is blocked or the entry is malformed */ }
        return null;
    }
    function resumeTrip(trip) {
        trip.visited.forEach(function (v, i) { if (v && chips[i]) chips[i].classList.add("is-visited"); });
        game.resume(trip.stop);
    }
    let trip = takeTrip();
    if (trip) {
        stage.classList.add("is-resuming"); // skip the introduction and wait in the dark for the river
        setFade(true);
    }

    function fail(message) {
        stage.classList.remove("is-resuming");
        setFade(false);
        statusEl.innerHTML = message + '<br><span class="cr-fail-links">' + STOPS.map(function (s) {
            return '<a href="' + s.href + '">' + s.name + "</a>";
        }).join(" &middot; ") + "</span>";
        statusEl.classList.add("is-error");
        startBtn.hidden = true;
        hud.hidden = true;
    }

    function webglAvailable() {
        try {
            return !!document.createElement("canvas").getContext("webgl2");
        } catch (e) {
            return false;
        }
    }

    async function load() {
        if (!webglAvailable()) return fail("Your browser can't show the 3D river, but every landing is still a click away:");
        let THREE;
        try {
            THREE = await import(THREE_URL);
        } catch (e) {
            console.error(e);
            return fail("The 3D river didn't load (the network may be blocking it). The landings:");
        }
        await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); // let "Loading" paint first
        try {
            game = await createGame(THREE, {
                canvas: canvas, stage: stage, lowPower: lowPower, reduceMotion: reduceMotion,
                labels: labels, showStop: showStop, toast: toast, setFade: setFade, saveTrip: saveTrip
            });
        } catch (e) {
            console.error(e);
            return fail("Something went wrong building the river. The landings:");
        }
        statusEl.hidden = true;
        startBtn.hidden = false;
        new ResizeObserver(function () { game.resize(); }).observe(stage);
        if (trip) {
            resumeTrip(trip);
            stage.classList.remove("is-resuming");
            trip = null;
        }
        updateActive();
    }

    // Only animate while the river is on screen and the tab is visible
    let onScreen = false;
    function updateActive() {
        if (game) game.setActive(onScreen && !document.hidden);
    }
    if ("IntersectionObserver" in window) {
        const loader = new IntersectionObserver(function (entries) {
            if (entries.some(function (e) { return e.isIntersecting; })) {
                loader.disconnect();
                load();
            }
        }, { rootMargin: "400px 0px" });
        loader.observe(stage);
        new IntersectionObserver(function (entries) {
            onScreen = entries[entries.length - 1].isIntersecting;
            updateActive();
        }, { threshold: 0.05 }).observe(stage);
    } else {
        onScreen = true;
        load();
    }
    document.addEventListener("visibilitychange", updateActive);
    // the browser's back button can restore this page as it was left, faded out at a dock
    window.addEventListener("pageshow", function (e) {
        if (!e.persisted || !game) return;
        const back = takeTrip();
        if (back) resumeTrip(back);
        else game.returned();
    });

    function begin() {
        if (!game) return;
        game.start();
        stage.focus({ preventScroll: true });
    }
    startBtn.addEventListener("click", begin);

    // "Go ashore" fades out and remembers the landing before following the link
    card.addEventListener("click", function (e) {
        if (!game || !e.target.closest(".cr-ashore") || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        game.goAshore();
    });

    const KEYS = {
        KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back",
        KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right"
    };
    // The river fills most of the page, so the steering keys work with nothing focused too, as long as
    // the river is what's on screen. Keys on buttons and links keep their normal behaviour.
    function riverInView() {
        const r = stage.getBoundingClientRect(), mid = window.innerHeight / 2;
        return r.top < mid && r.bottom > mid;
    }
    document.addEventListener("keydown", function (e) {
        if (!game || e.altKey || e.ctrlKey || e.metaKey) return;
        const onStage = e.target === stage;
        if (!onStage && !(e.target === document.body && riverInView())) return;
        const key = KEYS[e.code];
        if (key) {
            e.preventDefault();
            if (!onStage) stage.focus({ preventScroll: true }); // so the key-up lands on the river too
            game.start();
            game.setKey(key, true);
        } else if (e.code === "KeyE" || (onStage && (e.code === "Enter" || e.code === "Space"))) {
            e.preventDefault();
            if (!game.started) begin();
            else if (e.code !== "Space") game.goAshore();
        } else if (onStage && e.code === "Escape" && stage.classList.contains("is-expanded")) {
            toggleExpanded();
        }
    });
    stage.addEventListener("keyup", function (e) {
        const key = KEYS[e.code];
        if (game && key) game.setKey(key, false);
    });
    stage.addEventListener("blur", function () { if (game) game.releaseKeys(); });

    // Drag the view around; it eases back behind the canoe a moment after you let go
    let drag = null;
    canvas.addEventListener("pointerdown", function (e) {
        if (!game) return;
        stage.focus({ preventScroll: true });
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        game.look(e.clientX - drag.x, e.clientY - drag.y);
        drag.x = e.clientX;
        drag.y = e.clientY;
    });
    function endDrag() {
        drag = null;
        canvas.classList.remove("is-dragging");
    }
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    stage.querySelectorAll(".cr-touch button").forEach(function (btn) {
        const key = btn.dataset.key;
        function up() {
            btn.classList.remove("is-down");
            if (game) game.setKey(key, false);
        }
        btn.addEventListener("pointerdown", function (e) {
            e.preventDefault();
            if (!game) return;
            game.start();
            game.setKey(key, true);
            btn.classList.add("is-down");
            btn.setPointerCapture(e.pointerId);
        });
        btn.addEventListener("pointerup", up);
        btn.addEventListener("pointercancel", up);
        btn.addEventListener("lostpointercapture", up);
        btn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    });

    // Full screen where the browser allows it on an element (not iPhone Safari); a fixed overlay otherwise
    function toggleExpanded() {
        const on = stage.classList.toggle("is-expanded");
        document.body.style.overflow = on ? "hidden" : "";
        fsBtn.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
    }
    fsBtn.addEventListener("click", function () {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (stage.requestFullscreen && !stage.classList.contains("is-expanded")) stage.requestFullscreen().catch(toggleExpanded);
        else toggleExpanded();
        stage.focus({ preventScroll: true });
    });
    document.addEventListener("fullscreenchange", function () {
        fsBtn.setAttribute("aria-label", document.fullscreenElement ? "Exit full screen" : "Full screen");
    });

    // ---------- the 3D scene ----------

    async function createGame(THREE, ui) {
        const high = !ui.lowPower;
        const rand = makeRng(20261026);
        const pick = function (list) { return list[Math.floor(rand() * list.length)]; };
        const color = function (hex) { return new THREE.Color(hex); };
        const glslColor = function (hex) {
            const c = new THREE.Color(hex);
            return "vec3(" + c.r.toFixed(4) + ", " + c.g.toFixed(4) + ", " + c.b.toFixed(4) + ")";
        };

        const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: high, powerPreference: "high-performance" });
        let pixelRatio = Math.min(window.devicePixelRatio || 1, high ? 1.5 : 1.25);
        renderer.setPixelRatio(pixelRatio);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.shadowMap.autoUpdate = false; // rendered once per frame, shared by the reflection pass
        const maxAniso = renderer.capabilities.getMaxAnisotropy();

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x000000, 0.0001); // switches fog on; the real haze is crAtmosphere below
        const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 7000);

        // Late-afternoon sun, low and off to the side so it rakes across the valley
        const sunDir = new THREE.Vector3(-0.82, 0.3, 0.42).normalize();
        const U = {
            uTime: { value: 0 },
            uSunDir: { value: sunDir },
            uSunCol: { value: color("#ffd7a3") },
            uSkyZen: { value: color("#3f6fa8") },
            uHazeCool: { value: color("#9fb5cb") },
            uHazeWarm: { value: color("#f3cf9e") },
            // height-fog density at y0, height falloff, y0, distance haze
            uFogParams: { value: new THREE.Vector4(0.0011, 0.012, 0.0, 0.00035) },
            uMist: { value: 1.0 },
            uReflect: { value: 0 }
        };

        // Shared shader code: noise, sky and haze colours, and an aerial-perspective fog that pools in the
        // valley and drifts as mist on the water. Applied to every material before tone mapping, so the
        // haze on the hills matches the sky behind them.
        const COMMON_GLSL = `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyZen;
uniform vec3 uHazeCool;
uniform vec3 uHazeWarm;
uniform vec4 uFogParams;
uniform float uMist;
uniform float uReflect;

float crHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float crNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(crHash(i), crHash(i + vec2(1.0, 0.0)), u.x),
               mix(crHash(i + vec2(0.0, 1.0)), crHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 crHaze(vec3 rd) {
    float s = max(dot(rd, uSunDir), 0.0);
    vec3 c = mix(uHazeCool, uHazeWarm, pow(s, 3.0) * 0.9);
    return c + uSunCol * (pow(s, 16.0) * 0.15 + pow(s, 120.0) * 0.3);
}
vec3 crSky(vec3 rd) {
    float h = max(rd.y, 0.0);
    vec3 col = mix(crHaze(rd), uSkyZen, pow(smoothstep(0.0, 0.75, h), 0.6));
    float s = max(dot(rd, uSunDir), 0.0);
    return col + uSunCol * (pow(s, 5.0) * 0.1 + pow(s, 48.0) * 0.35);
}
vec3 crAtmosphere(vec3 col, vec3 wp) {
    vec3 ro = cameraPosition;
    if (uReflect > 0.5) ro.y = -ro.y;
    vec3 dv = wp - ro;
    float dist = length(dv);
    vec3 rd = dv / max(dist, 0.001);
    float k = uFogParams.y * dv.y;
    float fog = uFogParams.x * exp(-uFogParams.y * (ro.y - uFogParams.z)) * dist * (abs(k) > 0.0001 ? (1.0 - exp(-k)) / k : 1.0);
    float m = clamp(1.0 - wp.y / 6.0, 0.0, 1.0);
    float mist = uMist * m * m * max(crNoise(wp.xz * 0.03 + uTime * vec2(0.03, -0.05)) * 1.4 - 0.45, 0.0) * min(dist, 160.0) * 0.004;
    float T = exp(-(fog + uFogParams.w * dist + mist));
    return mix(crHaze(normalize(vec3(rd.x, max(rd.y, -0.02), rd.z))), col, T);
}
`;
        THREE.ShaderChunk.common += "\n" + COMMON_GLSL;
        THREE.ShaderChunk.fog_pars_vertex = "#ifdef USE_FOG\nvarying vec3 vFogWorld;\n#endif";
        THREE.ShaderChunk.fog_vertex = [
            "#ifdef USE_FOG",
            "    vec4 crFogPos = vec4(transformed, 1.0);",
            "    #ifdef USE_INSTANCING",
            "        crFogPos = instanceMatrix * crFogPos;",
            "    #endif",
            "    vFogWorld = (modelMatrix * crFogPos).xyz;",
            "#endif"
        ].join("\n");
        THREE.ShaderChunk.fog_pars_fragment = "#ifdef USE_FOG\nvarying vec3 vFogWorld;\n#endif";
        THREE.ShaderChunk.fog_fragment = "";
        THREE.ShaderChunk.opaque_fragment += "\n#ifdef USE_FOG\ngl_FragColor.rgb = crAtmosphere(gl_FragColor.rgb, vFogWorld);\n#endif";

        // Hook a built-in material up to the shared uniforms, optionally with extra shader edits
        function atmos(material, key, edit) {
            material.onBeforeCompile = function (shader) {
                Object.assign(shader.uniforms, U);
                if (edit) edit(shader);
            };
            material.customProgramCacheKey = function () { return "cr-" + (key || "plain"); };
            return material;
        }

        const sun = new THREE.DirectionalLight(color("#ffd39c"), 3.9);
        sun.castShadow = true;
        sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
        const shadowCam = sun.shadow.camera;
        shadowCam.left = -42;
        shadowCam.right = 42;
        shadowCam.top = 42;
        shadowCam.bottom = -42;
        shadowCam.near = 1;
        shadowCam.far = 520;
        sun.shadow.bias = -0.0008;
        sun.shadow.normalBias = 0.12;
        scene.add(sun, sun.target);
        scene.add(new THREE.HemisphereLight(color("#b4c8de"), color("#5b4a33"), 1.5));

        // ---------- sky ----------

        const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), new THREE.ShaderMaterial({
            uniforms: U,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            vertexShader: `
varying vec3 vDir;
void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
}`,
            fragmentShader: `
#include <common>
varying vec3 vDir;
float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * crNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
}
void main() {
    vec3 rd = normalize(vDir);
    vec3 col = crSky(rd);
    float cover = 0.0;
    if (rd.y > 0.0) {
        // fair-weather cumulus, lit gold on the side facing the sun
        vec2 cp = rd.xz / (rd.y + 0.15) * 1.3 + vec2(uTime * 0.006, uTime * 0.002);
        float n = fbm(cp);
        cover = smoothstep(0.52, 0.74, n) * smoothstep(0.02, 0.22, rd.y);
        float lit = clamp(0.55 + (n - fbm(cp + uSunDir.xz * 0.12)) * 4.0, 0.0, 1.0);
        float s = max(dot(rd, uSunDir), 0.0);
        vec3 cloud = mix(vec3(0.45, 0.48, 0.56), vec3(1.0, 0.92, 0.82), lit) * (0.85 + uSunCol * pow(s, 4.0) * 0.8);
        col = mix(col, cloud, cover * 0.9);
    }
    col += uSunCol * smoothstep(0.9993, 0.9997, dot(rd, uSunDir)) * 12.0 * (1.0 - cover);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`
        }));
        sky.renderOrder = -1;
        sky.frustumCulled = false;
        scene.add(sky);

        // ---------- terrain ----------

        const CANOPY_GLSL = `
vec3 crCanopy(vec3 p) {
    float grove = crNoise(p.xz * 0.012 + 40.0) * 0.65 + crNoise(p.xz * 0.05 + 3.0) * 0.35;
    float t = clamp(grove + (crNoise(p.xz * 0.16) - 0.5) * 0.5, 0.0, 1.0);
    vec3 c = ${glslColor(LEAVES.green[0])};
    c = mix(c, ${glslColor(LEAVES.yellow[0])}, smoothstep(0.43, 0.48, t));
    c = mix(c, ${glslColor(LEAVES.orange[0])}, smoothstep(0.54, 0.59, t));
    c = mix(c, ${glslColor(LEAVES.red[0])}, smoothstep(0.64, 0.69, t));
    c = mix(c, ${glslColor(LEAVES.evergreen[0])}, smoothstep(0.6, 0.68, crNoise(p.xz * 0.03 - 9.0)) * 0.85);
    float crowns = crNoise(p.xz * 0.3) * 0.6 + crNoise(p.xz * 0.9 + 5.0) * 0.4;
    return c * (0.6 + 0.55 * crowns);
}`;
        // Leaf-litter, gravel and rock come from vertex colours; the hillsides beyond the modelled trees
        // get a mottled fall canopy (with bumpy lighting) in the shader
        const terrainMat = atmos(new THREE.MeshLambertMaterial({ vertexColors: true }), "terrain", function (shader) {
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", "#include <common>\nattribute float aCanopy;\nvarying float vCanopy;")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCanopy = aCanopy;");
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", "#include <common>\nvarying float vCanopy;\n" + CANOPY_GLSL)
                .replace("#include <color_fragment>", "#include <color_fragment>\nif (vCanopy > 0.001) diffuseColor.rgb = mix(diffuseColor.rgb, crCanopy(vFogWorld), vCanopy);")
                .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
if (vCanopy > 0.001) {
    vec2 q = vFogWorld.xz * 0.3;
    float n0 = crNoise(q), nx = crNoise(q + vec2(0.4, 0.0)), nz = crNoise(q + vec2(0.0, 0.4));
    normal = normalize(normal + (viewMatrix * vec4((n0 - nx) * 2.5, 0.0, (n0 - nz) * 2.5, 0.0)).xyz * vCanopy);
}`);
        });

        function buildTerrain() {
            const xs = [];
            for (let x = -660; x < 660;) {
                xs.push(x);
                const ax = Math.abs(x);
                x += ax < 170 ? (high ? 2 : 3) : 2 + (ax - 170) * 0.07;
            }
            xs.push(660);
            const zs = [];
            for (let z = RIVER.zMax; z >= RIVER.zMin; z -= high ? 2.5 : 3.5) zs.push(z);
            const nx = xs.length, nz = zs.length;
            const pos = new Float32Array(nx * nz * 3);
            for (let j = 0; j < nz; j++) {
                for (let i = 0; i < nx; i++) {
                    const k = (j * nx + i) * 3;
                    pos[k] = xs[i];
                    pos[k + 1] = terrainHeight(xs[i], zs[j]);
                    pos[k + 2] = zs[j];
                }
            }
            const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
            let n = 0;
            for (let j = 0; j < nz - 1; j++) {
                for (let i = 0; i < nx - 1; i++) {
                    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
                    index[n++] = a; index[n++] = b; index[n++] = c;
                    index[n++] = b; index[n++] = d; index[n++] = c;
                }
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
            geo.setIndex(new THREE.BufferAttribute(index, 1));
            geo.computeVertexNormals();

            const C = {
                bedShallow: color("#857353"), bedDeep: color("#4f4c38"), wet: color("#5d584b"), gravel: color("#9a8f78"),
                grass: color("#86843f"), litter: color("#7e5a33"), rock: color("#76736b"), dirt: color("#7a6247")
            };
            const nor = geo.attributes.normal.array;
            const col = new Float32Array(nx * nz * 3), canopy = new Float32Array(nx * nz);
            const c = new THREE.Color(), tmp = new THREE.Color();
            for (let v = 0; v < nx * nz; v++) {
                const x = pos[v * 3], h = pos[v * 3 + 1], z = pos[v * 3 + 2];
                const u = Math.abs(riverOffset(x, z)) - riverHalfWidth(z);
                if (h < -0.05 && u < 0.5) {
                    c.copy(C.bedShallow).lerp(C.bedDeep, smoothstep(0.2, 2.0, -h));
                } else if (u < 3) {
                    c.copy(C.wet).lerp(C.gravel, smoothstep(-0.2, 3, u));
                } else {
                    c.copy(C.grass).lerp(C.litter, smoothstep(-0.3, 0.3, noise(x * 0.05, z * 0.05)));
                }
                const pw = padWeight(x, z);
                if (pw > 0) c.lerp(tmp.copy(C.grass).lerp(C.dirt, 0.25 + 0.3 * smoothstep(-0.4, 0.4, noise(x * 0.4, z * 0.4))), pw);
                const rocky = smoothstep(0.78, 0.58, nor[v * 3 + 1]);
                c.lerp(C.rock, rocky);
                c.multiplyScalar(0.88 + 0.24 * (0.5 + 0.5 * noise(x * 0.3, z * 0.3)));
                col[v * 3] = c.r;
                col[v * 3 + 1] = c.g;
                col[v * 3 + 2] = c.b;
                canopy[v] = smoothstep(35, 80, u) * (1 - rocky * 0.85) * (1 - pw);
            }
            geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
            geo.setAttribute("aCanopy", new THREE.BufferAttribute(canopy, 1));
            const mesh = new THREE.Mesh(geo, terrainMat);
            mesh.receiveShadow = true;
            scene.add(mesh);
        }

        // Layered ridgelines around the valley; the haze turns each one a paler blue than the last
        function buildRidges() {
            const layers = [
                { r: 1100, w: 520, h: 360, color: "#33493a" },
                { r: 1750, w: 760, h: 500, color: "#36504c" },
                { r: 2600, w: 950, h: 650, color: "#3d5764" },
                { r: 3700, w: 1300, h: 820, color: "#48607a" }
            ];
            const cz = (RIVER.zMax + RIVER.zMin) / 2, SEG = 220, ROWS = 7;
            const mat = atmos(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
            layers.forEach(function (layer, k) {
                const pos = [], col = [], index = [];
                const base = color(layer.color);
                for (let a = 0; a <= SEG; a++) {
                    const th = a / SEG * Math.PI * 2, cx = Math.cos(th), sz = Math.sin(th);
                    const crest = layer.h * (0.6 + 0.4 * (0.5 + 0.5 * fbm(cx * 3.2 + k * 7.1, sz * 3.2 - k * 2.3, 3)));
                    for (let r = 0; r <= ROWS; r++) {
                        const t = r / ROWS, rad = layer.r - layer.w / 2 + layer.w * t;
                        const prof = Math.pow(Math.sin(Math.PI * t), 0.9);
                        const y = -30 + crest * prof * (0.85 + 0.15 * noise(cx * 14 + t * 2, sz * 14 + k));
                        pos.push(cx * rad, y, cz + sz * rad);
                        const shade = 0.85 + 0.3 * (0.5 + 0.5 * noise(cx * 30, sz * 30 + t * 4));
                        col.push(base.r * shade, base.g * shade, base.b * shade);
                    }
                }
                for (let a = 0; a < SEG; a++) {
                    for (let r = 0; r < ROWS; r++) {
                        const i0 = a * (ROWS + 1) + r, i1 = i0 + ROWS + 1;
                        index.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
                    }
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
                geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
                geo.setIndex(index);
                geo.computeVertexNormals();
                scene.add(new THREE.Mesh(geo, mat));
            });
        }

        // ---------- rocks ----------

        const obstacles = []; // things the canoe bumps into: {x, z, r}
        const foamRocks = [];  // things that churn the water: {x, z, r, strength, fx, fz}

        function rockGeometry(detail, moss) {
            const geo = new THREE.IcosahedronGeometry(1, detail);
            const p = geo.attributes.position;
            for (let i = 0; i < p.count; i++) {
                const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
                const d = 1 + 0.22 * noise(x * 1.7 + 3.1, y * 1.7 + z * 1.3) + 0.08 * noise(x * 4.1, z * 4.1 - y * 2);
                p.setXYZ(i, x * d, Math.max(y * d, -0.55), z * d);
            }
            geo.computeVertexNormals(); // faceted, like split stone
            const n = geo.attributes.normal, col = new Float32Array(p.count * 3);
            const stone = color("#8c877b"), green = color("#5f7034"), c = new THREE.Color();
            for (let i = 0; i < p.count; i++) {
                c.copy(stone).multiplyScalar(0.85 + 0.3 * (0.5 + 0.5 * noise(p.getX(i) * 3, p.getZ(i) * 3 + p.getY(i))));
                if (moss) c.lerp(green, smoothstep(0.5, 0.85, n.getY(i)) * 0.85);
                col[i * 3] = c.r;
                col[i * 3 + 1] = c.g;
                col[i * 3 + 2] = c.b;
            }
            geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
            geo.deleteAttribute("uv");
            return geo;
        }

        function nearDock(z, side, range) {
            return STOPS.some(function (s) { return (side === 0 || s.side === side) && Math.abs(s.z - z) < range; });
        }

        function buildRocks() {
            const rng = makeRng(1234);
            const river = [], bank = [], forest = [];
            function addRock(list, x, z, y, r, sy, foamK) {
                list.push({ x: x, y: y, z: z, r: r, sy: sy, yaw: rng() * 6.28, tilt: (rng() - 0.5) * 0.3 });
                // where it cuts the surface, it's an obstacle and throws white water
                const top = y + r * sy;
                const s = riverSlope(z), inv = 1 / Math.sqrt(1 + s * s);
                const inWater = Math.abs(riverOffset(x, z)) < riverHalfWidth(z) + 0.5;
                if (!inWater) return;
                if (top > 0.05 && Math.abs(y) < r * sy) {
                    const rw = r * Math.sqrt(1 - (y / (r * sy)) * (y / (r * sy)));
                    obstacles.push({ x: x, z: z, r: rw * 0.95 });
                    foamRocks.push({ x: x, z: z, r: rw, strength: foamK === undefined ? 1 : foamK, fx: -s * inv, fz: -inv });
                } else if (top > -0.45) {
                    foamRocks.push({ x: x, z: z, r: r * 0.8, strength: smoothstep(-0.45, 0.05, top) * 0.7 * (foamK === undefined ? 1 : foamK), fx: -s * inv, fz: -inv });
                }
            }
            // boulders standing in the current, clear of the middle of the channel
            for (let z = RIVER.zMax - 30; z > RIVER.zMin + 120; z -= 9 + rng() * 14) {
                const side = rng() < 0.5 ? -1 : 1;
                if (nearDock(z, side, 30)) continue;
                const hw = riverHalfWidth(z), p = riverPoint(z, side * hw * (0.45 + rng() * 0.45));
                addRock(river, p.x, p.z, -0.25 - rng() * 0.2, 0.5 + rng() * 0.9, 0.55 + rng() * 0.35);
            }
            // rock gardens in the riffles; most are just under the surface and show as white water
            for (const c of RIFFLES) {
                for (let i = 0; i < 30; i++) {
                    const z = c + (rng() - 0.5) * 56, hw = riverHalfWidth(z);
                    if (rng() < 0.7) {
                        const p = riverPoint(z, (rng() * 2 - 1) * hw * 0.9);
                        addRock(river, p.x, p.z, -0.75 - rng() * 0.2, 0.5 + rng() * 0.5, 0.6);
                    } else {
                        const side = rng() < 0.5 ? -1 : 1, p = riverPoint(z, side * hw * (0.4 + rng() * 0.5));
                        addRock(river, p.x, p.z, -0.3, 0.4 + rng() * 0.5, 0.7 + rng() * 0.3);
                    }
                }
            }
            // boulders lining the water's edge
            for (const side of [-1, 1]) {
                for (let z = RIVER.zMax; z > RIVER.zMin; z -= 2.2 + rng() * 3.5) {
                    if (rng() < 0.35 || nearDock(z, side, 16)) continue;
                    const hw = riverHalfWidth(z), u = -0.8 + rng() * 3.5;
                    const p = riverPoint(z, side * (hw + u));
                    const r = rng() < 0.12 ? 1.6 + rng() * 1.0 : 0.45 + rng() * 1.1;
                    addRock(bank, p.x, p.z, terrainHeight(p.x, p.z) - r * 0.3, r, 0.6 + rng() * 0.35, 0.3); // slack water along the bank
                }
            }
            // and scattered through the woods
            for (let i = 0; i < (high ? 260 : 140); i++) {
                const z = lerp(RIVER.zMax, RIVER.zMin, rng()), side = rng() < 0.5 ? -1 : 1;
                const p = riverPoint(z, side * (riverHalfWidth(z) + 12 + rng() * 110));
                if (padWeight(p.x, p.z) > 0.05) continue;
                const r = 0.5 + rng() * rng() * 2.5;
                addRock(forest, p.x, p.z, terrainHeight(p.x, p.z) - r * 0.35, r, 0.55 + rng() * 0.3);
            }

            const mat = atmos(new THREE.MeshLambertMaterial({ vertexColors: true }));
            const tint = new THREE.Color();
            instanced(river, rockGeometry(2, false), mat, true, function (it, m) { rockMatrix(it, m); return tint.setScalar(0.7 + rng() * 0.2); }, 400);
            instanced(bank, rockGeometry(2, true), mat, true, function (it, m) { rockMatrix(it, m); return tint.setScalar(0.85 + rng() * 0.25); }, 300);
            instanced(forest, rockGeometry(1, true), mat, false, function (it, m) { rockMatrix(it, m); return tint.setScalar(0.8 + rng() * 0.3); }, 250, true);
        }

        const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3();
        const _e = new THREE.Euler(), _axis = new THREE.Vector3();
        const UP = new THREE.Vector3(0, 1, 0);

        function rockMatrix(it, m) {
            _q.setFromEuler(_e.set(it.tilt, it.yaw, it.tilt * 0.5));
            m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.r * 1.1, it.r * it.sy, it.r));
        }

        // Instanced meshes split into 75 m slices along the river, so slices off screen get culled and
        // slices beyond `range` metres are skipped (by then the haze and the canopy shading cover them).
        // noReflect leaves them out of the water's reflection pass.
        const slices = [];
        function instanced(items, geo, mat, castShadow, setup, range, noReflect) {
            const groups = new Map();
            for (const it of items) {
                const k = Math.floor(it.z / 75);
                if (!groups.has(k)) groups.set(k, []);
                groups.get(k).push(it);
            }
            const m = new THREE.Matrix4();
            groups.forEach(function (list, k) {
                const mesh = new THREE.InstancedMesh(geo, mat, list.length);
                list.forEach(function (it, i) {
                    const tint = setup(it, m);
                    mesh.setMatrixAt(i, m);
                    if (tint) mesh.setColorAt(i, tint);
                });
                mesh.castShadow = castShadow;
                mesh.receiveShadow = true;
                mesh.computeBoundingSphere();
                scene.add(mesh);
                slices.push({ mesh: mesh, z: (k + 0.5) * 75, range: range + 40, noReflect: !!noReflect });
            });
        }

        // ---------- forest ----------

        // Merge non-indexed geometries that carry position, normal and colour
        function mergeGeometries(list) {
            let count = 0;
            for (const g of list) count += g.attributes.position.count;
            const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
            let o = 0;
            for (const g of list) {
                const n = g.attributes.position.count;
                pos.set(g.attributes.position.array, o * 3);
                nor.set(g.attributes.normal.array, o * 3);
                if (g.attributes.color) col.set(g.attributes.color.array, o * 3);
                else col.fill(1, o * 3, (o + n) * 3);
                o += n;
                g.dispose();
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
            geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
            geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
            geo.computeBoundingSphere();
            return geo;
        }

        // Grey leaf-cluster and needle-spray sprites; every tree tints them with its own instance colour
        function foliageTexture(draw) {
            const cv = document.createElement("canvas");
            cv.width = cv.height = 256;
            draw(cv.getContext("2d"), makeRng(77));
            const tex = new THREE.CanvasTexture(cv);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = Math.min(4, maxAniso);
            return tex;
        }
        const leafTex = foliageTexture(function (g, r) {
            // denser toward the middle, ragged at the edges, with gaps you can see sky through
            for (let i = 0; i < 360; i++) {
                const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * 120;
                const v = Math.round(140 + r() * 115);
                g.fillStyle = "rgb(" + v + "," + v + "," + Math.round(v * 0.92) + ")";
                g.save();
                g.translate(128 + Math.cos(a) * d, 128 + Math.sin(a) * d);
                g.rotate(r() * Math.PI * 2);
                g.beginPath();
                g.ellipse(0, 0, 5 + r() * 4.5, 2.6 + r() * 2, 0, 0, Math.PI * 2);
                g.fill();
                g.restore();
            }
        });
        const needleTex = foliageTexture(function (g, r) {
            // a flat spray of hemlock needles, fanning out from its base at the bottom edge
            g.lineCap = "round";
            for (let s = 0; s < 5; s++) {
                const a = -Math.PI / 2 + (s - 2) * 0.3 + (r() - 0.5) * 0.12, len = 236 - Math.abs(s - 2) * 34;
                for (let t = 0.04; t < 1; t += 0.03) {
                    const x = 128 + Math.cos(a) * len * t, y = 254 + Math.sin(a) * len * t, nl = 26 * (1 - t * 0.55);
                    g.lineWidth = 2.4;
                    for (const side of [-1, 1]) {
                        const v = Math.round(130 + r() * 110), na = a + side * (1.0 + r() * 0.35);
                        g.strokeStyle = "rgb(" + v + "," + v + "," + v + ")";
                        g.beginPath();
                        g.moveTo(x, y);
                        g.lineTo(x + Math.cos(na) * nl, y + Math.sin(na) * nl);
                        g.stroke();
                    }
                }
                g.strokeStyle = "rgb(90, 80, 70)";
                g.lineWidth = 2;
                g.beginPath();
                g.moveTo(128, 254);
                g.lineTo(128 + Math.cos(a) * len, 254 + Math.sin(a) * len);
                g.stroke();
            }
        });

        // Alpha-tested foliage. Normals aren't flipped on back faces (each crown shades as one soft volume),
        // alpha is boosted in the smaller mip levels so distant crowns don't thin out, and leaves glow a
        // little when the low sun shines through them.
        function foliageMaterial(map, key) {
            const mat = new THREE.MeshLambertMaterial({ map: map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
            return atmos(mat, key, function (shader) {
                shader.fragmentShader = shader.fragmentShader
                    .replace("#include <normal_fragment_begin>", THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", ""))
                    .replace("#include <map_fragment>", `#include <map_fragment>
vec2 crTs = vec2(textureSize(map, 0));
vec2 crDx = dFdx(vMapUv * crTs), crDy = dFdy(vMapUv * crTs);
diffuseColor.a *= 1.0 + 0.3 * max(0.0, 0.5 * log2(max(dot(crDx, crDx), dot(crDy, crDy))));`)
                    .replace("#include <opaque_fragment>", `outgoingLight += diffuseColor.rgb * uSunCol * 0.55 * pow(max(dot(normalize(-vViewPosition), (viewMatrix * vec4(uSunDir, 0.0)).xyz), 0.0), 4.0);
#include <opaque_fragment>`);
            });
        }
        const leafMat = foliageMaterial(leafTex, "leaf");
        const needleMat = foliageMaterial(needleTex, "needle");
        const barkMat = atmos(new THREE.MeshLambertMaterial({ vertexColors: true }));

        // Accumulates foliage quads: 4 corners each, normals and shading from callbacks
        function CardSet() { this.pos = []; this.nor = []; this.uv = []; this.col = []; }
        CardSet.prototype.add = function (corners, normalAt, shadeAt) {
            const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]], n = new THREE.Vector3();
            for (const k of [0, 1, 2, 0, 2, 3]) {
                const p = corners[k];
                this.pos.push(p.x, p.y, p.z);
                normalAt(p, n);
                this.nor.push(n.x, n.y, n.z);
                this.uv.push(uvs[k][0], uvs[k][1]);
                const s = shadeAt(p);
                this.col.push(s, s, s);
            }
        };
        CardSet.prototype.geometry = function () {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
            geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
            geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
            geo.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
            geo.computeBoundingSphere();
            return geo;
        };

        // Broadleaf crown: leaf cards scattered through a few overlapping lobes, mostly facing outward.
        // Vertex colour is shading only (darker underneath and deep inside).
        function leafCrown(lobes, count, size0, size1, seed) {
            const r = makeRng(seed), cards = new CardSet();
            const center = new THREE.Vector3();
            let top = -Infinity, bottom = Infinity, total = 0;
            for (const b of lobes) {
                center.x += b.x * b.r;
                center.y += b.y * b.r;
                center.z += b.z * b.r;
                total += b.r;
                top = Math.max(top, b.y + b.r * (b.sy || 1));
                bottom = Math.min(bottom, b.y - b.r * (b.sy || 1));
            }
            center.divideScalar(total);
            const p = new THREE.Vector3(), n = new THREE.Vector3(), ax = new THREE.Vector3(), ay = new THREE.Vector3(), tmp = new THREE.Vector3();
            const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
            const normalAt = function (q, out) {
                out.subVectors(q, center);
                out.y *= 0.8;
                out.normalize();
            };
            for (let i = 0; i < count; i++) {
                let pickAt = r() * total, b = lobes[0];
                for (const l of lobes) {
                    pickAt -= l.r;
                    if (pickAt <= 0) {
                        b = l;
                        break;
                    }
                }
                const u = r() * 2 - 1, th = r() * Math.PI * 2, sr = Math.sqrt(1 - u * u);
                n.set(sr * Math.cos(th), u, sr * Math.sin(th));
                const depth = 0.3 + 0.6 * Math.sqrt(r());
                p.set(b.x + n.x * b.r * depth, b.y + n.y * b.r * depth * (b.sy || 1), b.z + n.z * b.r * depth);
                n.x += (r() - 0.5) * 1.4;
                n.y += (r() - 0.5) * 1.4;
                n.z += (r() - 0.5) * 1.4;
                n.normalize();
                tmp.set(r() - 0.5, r() - 0.5, r() - 0.5);
                ax.crossVectors(n, tmp).normalize();
                ay.crossVectors(n, ax);
                const s = lerp(size0, size1, r()) / 2, tint = 0.85 + 0.3 * r();
                corners[0].copy(p).addScaledVector(ax, -s).addScaledVector(ay, -s);
                corners[1].copy(p).addScaledVector(ax, s).addScaledVector(ay, -s);
                corners[2].copy(p).addScaledVector(ax, s).addScaledVector(ay, s);
                corners[3].copy(p).addScaledVector(ax, -s).addScaledVector(ay, s);
                cards.add(corners, normalAt, function (q) {
                    return (0.38 + 0.62 * smoothstep(bottom, top, q.y)) * (0.72 + 0.3 * depth) * tint;
                });
            }
            return cards.geometry();
        }

        // Hemlock: tiers of drooping needle sprays around the trunk, rolled so they aren't edge-on from the side
        function needleCrown(seed) {
            const r = makeRng(seed), cards = new CardSet();
            const o = new THREE.Vector3(), tg = new THREE.Vector3(), w = new THREE.Vector3(), cr = new THREE.Vector3(), b0 = new THREE.Vector3();
            const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
            const TIERS = 11;
            for (let t = 0; t < TIERS; t++) {
                const k = t / (TIERS - 1), y = 2.2 + k * 13.5, R = lerp(3.4, 0.8, k), count = Math.round(lerp(7, 4, k));
                for (let i = 0; i < count; i++) {
                    const a = (i + r() * 0.6) / count * Math.PI * 2 + t * 0.9;
                    const droop = 0.3 + r() * 0.3, roll = (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.5);
                    o.set(Math.cos(a) * Math.cos(droop), -Math.sin(droop), Math.sin(a) * Math.cos(droop));
                    tg.set(-Math.sin(a), 0, Math.cos(a));
                    cr.crossVectors(o, tg).normalize();
                    w.copy(tg).multiplyScalar(Math.cos(roll)).addScaledVector(cr, Math.sin(roll));
                    b0.set(Math.cos(a) * 0.15, y, Math.sin(a) * 0.15);
                    const half = R * 0.45, shade = (0.5 + 0.5 * k) * (0.85 + 0.3 * r());
                    corners[0].copy(b0).addScaledVector(w, -half * 0.6);
                    corners[1].copy(b0).addScaledVector(w, half * 0.6);
                    corners[2].copy(b0).addScaledVector(o, R).addScaledVector(w, half);
                    corners[3].copy(b0).addScaledVector(o, R).addScaledVector(w, -half);
                    cards.add(corners, function (q, out) {
                        out.set(q.x, 0, q.z).normalize();
                        out.y = 0.45;
                        out.normalize();
                    }, function (q) {
                        return shade * (0.6 + 0.4 * clamp(Math.hypot(q.x, q.z) / R, 0, 1));
                    });
                }
            }
            // the leader at the very top
            for (const a of [0, Math.PI / 2]) {
                tg.set(Math.cos(a), 0, Math.sin(a));
                corners[0].set(0, 15.2, 0).addScaledVector(tg, -0.55);
                corners[1].set(0, 15.2, 0).addScaledVector(tg, 0.55);
                corners[2].set(0, 18.2, 0).addScaledVector(tg, 0.3);
                corners[3].set(0, 18.2, 0).addScaledVector(tg, -0.3);
                cards.add(corners, function (q, out) { out.set(0, 1, 0); }, function () { return 1; });
            }
            return cards.geometry();
        }

        // Trunk, plus a few limbs reaching up into the crown (they show through the gaps in the leaves)
        function trunkGeometry(height, r0, r1, limbs) {
            const parts = [];
            const add = function (b0, b1, h, y, rx, rz) {
                const g = new THREE.CylinderGeometry(b1, b0, h, 6, 1, true);
                g.translate(0, h / 2, 0);
                g.rotateX(rx);
                g.rotateZ(rz);
                g.translate(0, y, 0);
                const flat = g.toNonIndexed();
                g.dispose();
                flat.deleteAttribute("uv");
                parts.push(flat);
            };
            add(r0, r1, height, 0, 0, 0);
            for (const l of limbs || []) add(0.14, 0.04, l[0], l[1], l[2], l[3]);
            return mergeGeometries(parts);
        }

        function foliage(x, z) {
            const g = 0.5 + 0.6 * noise(x * 0.012 + 40, z * 0.012) + 0.25 * noise(x * 0.05, z * 0.05);
            const t = g + (rand() - 0.5) * 0.5;
            return color(pick(t < 0.36 ? LEAVES.green : t < 0.52 ? LEAVES.yellow : t < 0.68 ? LEAVES.orange : t < 0.82 ? LEAVES.red : LEAVES.brown));
        }

        const TREE = {
            hardCrown: leafCrown([
                { x: 0, y: 11.5, z: 0, r: 3.8 }, { x: 2.6, y: 9.4, z: 1.0, r: 3.0 },
                { x: -2.4, y: 9.8, z: -0.9, r: 3.1 }, { x: 0.4, y: 14.2, z: -0.5, r: 2.8 },
                { x: 0.6, y: 7.4, z: -2.2, r: 2.6 }
            ], high ? 46 : 34, 2.6, 3.9, 11),
            hardTrunk: trunkGeometry(12, 0.36, 0.14, [[4.5, 6.5, 0.2, 0.9], [4.5, 7.2, -0.7, -0.5], [4, 8.5, 0.8, 0.2]]),
            farCrown: leafCrown([{ x: 0, y: 10.5, z: 0, r: 4.3, sy: 1.15 }, { x: 1.5, y: 12.5, z: 0.5, r: 3 }], 16, 4.2, 5.6, 23),
            hemlock: needleCrown(31),
            hemlockTrunk: trunkGeometry(16, 0.3, 0.08),
            shrub: leafCrown([{ x: 0, y: 0.9, z: 0, r: 1.4, sy: 0.7 }, { x: 1.0, y: 0.7, z: 0.4, r: 1.0, sy: 0.75 }], 9, 1.3, 1.9, 41)
        };
        const bark = new THREE.Color();
        const crownSetup = function (it, out) { out.copy(it.m); return it.c; };
        const trunkSetup = function (it, out) { out.copy(it.m); return bark.setRGB(0.16, 0.14, 0.12).multiplyScalar(0.8 + rand() * 0.4); };

        function buildForest() {
            const density = high ? 1 : 0.6;
            const hard = [], hardFar = [], conifer = [], coniferFar = [], shrub = [];
            function scatter(stepZ, stepU, u0, u1, place) {
                for (const side of [-1, 1]) {
                    for (let z0 = RIVER.zMax; z0 > RIVER.zMin; z0 -= stepZ) {
                        for (let u = u0; u < u1; u += stepU) {
                            const z = z0 + (rand() - 0.5) * stepZ, uu = u + (rand() - 0.5) * stepU;
                            const p = riverPoint(z, side * (riverHalfWidth(z) + uu));
                            if (padWeight(p.x, p.z) > 0.05) continue;
                            const y = terrainHeight(p.x, p.z);
                            if (y < 0.25) continue;
                            const sx = terrainHeight(p.x + 1.5, p.z) - y, sz = terrainHeight(p.x, p.z + 1.5) - y;
                            if (sx * sx + sz * sz > 2.7) continue; // too steep: bare rock
                            place({ x: p.x, y: y, z: p.z, u: uu, side: side });
                        }
                    }
                }
            }
            // tall hardwoods and hemlocks crowding the banks, often leaning out over the water
            scatter(6 / Math.sqrt(density), 6.5 / Math.sqrt(density), 2.5, 48, function (it) {
                if (noise(it.x * 0.02, it.z * 0.02) < -0.45) return;
                it.s = 0.8 + rand() * 0.55;
                it.lean = it.u < 9 ? (0.06 + rand() * 0.18) * (1 - it.u / 9) : rand() * 0.05;
                it.leanX = -it.side;
                const hemlockOdds = (it.u < 18 ? 0.42 : 0.25) + 0.3 * noise(it.x * 0.01 + 7, it.z * 0.01);
                (rand() < hemlockOdds ? conifer : hard).push(it);
            });
            // the rest of the slope, sparser trees that are only ever seen from a distance
            scatter(10 / Math.sqrt(density), 10.5 / Math.sqrt(density), 50, 165, function (it) {
                it.s = 1.05 + rand() * 0.45;
                it.lean = rand() * 0.06;
                it.leanX = rand() < 0.5 ? -1 : 1;
                (rand() < 0.22 ? coniferFar : hardFar).push(it);
            });
            // rhododendron thickets along the water
            scatter(4.5 / Math.sqrt(density), 4, 0.8, 12, function (it) {
                if (rand() < 0.45) return;
                it.s = 0.7 + rand() * 0.7;
                it.lean = 0;
                it.leanX = 0;
                shrub.push(it);
            });

            function treeMatrix(it) {
                _q.setFromAxisAngle(UP, rand() * Math.PI * 2);
                if (it.lean) {
                    // tip toward the river (across the flow)
                    const s = riverSlope(it.z), inv = 1 / Math.sqrt(1 + s * s);
                    const dx = it.leanX * inv, dz = -it.leanX * s * inv;
                    _q2.setFromAxisAngle(_axis.set(dz, 0, -dx), it.lean);
                    _q.premultiply(_q2);
                }
                const w = it.s * (0.9 + rand() * 0.2);
                return new THREE.Matrix4().compose(_p.set(it.x, it.y - 0.3, it.z), _q, _s.set(w, it.s, w));
            }
            // the same matrix drives a tree's crown and trunk, so compute it once
            for (const list of [hard, hardFar, conifer, coniferFar, shrub]) {
                for (const it of list) {
                    it.m = treeMatrix(it);
                    it.c = list === conifer || list === coniferFar ? color(pick(LEAVES.evergreen)) : list === shrub ? color(pick(LEAVES.evergreen)).multiplyScalar(1.15) : foliage(it.x, it.z);
                }
            }
            instanced(hard, TREE.hardCrown, leafMat, true, crownSetup, 500);
            instanced(hard, TREE.hardTrunk, barkMat, true, trunkSetup, 250);
            instanced(hardFar, TREE.farCrown, leafMat, false, crownSetup, 750, true);
            instanced(conifer, TREE.hemlock, needleMat, true, crownSetup, 550);
            instanced(coniferFar, TREE.hemlock, needleMat, false, crownSetup, 750, true);
            instanced(conifer, TREE.hemlockTrunk, barkMat, true, trunkSetup, 250);
            instanced(shrub, TREE.shrub, leafMat, true, crownSetup, 220);
        }

        // ---------- water ----------

        // Tileable ripple normals: a sum of sine waves whose wave numbers are whole cycles per tile
        function waterNormalTexture() {
            const N = 256, rng = makeRng(5), waves = [];
            for (let i = 0; i < 40; i++) {
                const k = 1 + Math.floor(Math.pow(rng(), 1.7) * 26), a = rng() * Math.PI * 2;
                let kx = Math.round(Math.cos(a) * k * 0.7), ky = Math.round(Math.sin(a) * k);
                if (!kx && !ky) ky = 1;
                waves.push({ kx: kx, ky: ky, amp: 1 / Math.pow(kx * kx + ky * ky, 0.65), ph: rng() * Math.PI * 2 });
            }
            const gx = new Float32Array(N * N), gy = new Float32Array(N * N);
            let maxG = 0;
            for (let y = 0; y < N; y++) {
                for (let x = 0; x < N; x++) {
                    let dx = 0, dy = 0;
                    for (const w of waves) {
                        const c = Math.cos(2 * Math.PI * (w.kx * x / N + w.ky * y / N) + w.ph) * w.amp;
                        dx += c * w.kx;
                        dy += c * w.ky;
                    }
                    gx[y * N + x] = dx;
                    gy[y * N + x] = dy;
                    maxG = Math.max(maxG, Math.hypot(dx, dy));
                }
            }
            const data = new Uint8Array(N * N * 4);
            for (let i = 0; i < N * N; i++) {
                data[i * 4] = Math.round((gx[i] / maxG * 0.5 + 0.5) * 255);
                data[i * 4 + 1] = Math.round((gy[i] / maxG * 0.5 + 0.5) * 255);
                data[i * 4 + 2] = 255;
                data[i * 4 + 3] = 255;
            }
            const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.magFilter = THREE.LinearFilter;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.generateMipmaps = true;
            tex.anisotropy = Math.min(4, maxAniso);
            tex.needsUpdate = true;
            return tex;
        }

        const canFloatTarget = renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float");
        const reflTarget = new THREE.WebGLRenderTarget(1, 1, { type: canFloatTarget ? THREE.HalfFloatType : THREE.UnsignedByteType });
        let useReflection = high;
        const ripples = [];
        for (let i = 0; i < 6; i++) ripples.push(new THREE.Vector4(0, 0, -100, 0));
        let rippleNext = 0;
        function addRipple(x, z, strength) {
            ripples[rippleNext].set(x, z, U.uTime.value, strength);
            rippleNext = (rippleNext + 1) % ripples.length;
        }

        const waterUniforms = Object.assign({
            uNormalTex: { value: waterNormalTexture() },
            uReflTex: { value: reflTarget.texture },
            uTexMatrix: { value: new THREE.Matrix4() },
            uHasRefl: { value: useReflection ? 1 : 0 },
            uCanoe: { value: new THREE.Vector4() },
            uCanoeSpeed: { value: 0 },
            uRipples: { value: ripples },
            uDeep: { value: color("#2a5163") },
            uShallow: { value: color("#6f8a7e") },
            uBank: { value: color("#1d2a18") }
        }, U);

        const water = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
            uniforms: waterUniforms,
            transparent: true,
            vertexShader: `
attribute vec4 aRiver;
attribute vec3 aFlow;
uniform mat4 uTexMatrix;
varying vec3 vWorld;
varying vec4 vRiver;
varying vec3 vFlow;
varying vec4 vReflUv;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vRiver = aRiver;
    vFlow = aFlow;
    vReflUv = uTexMatrix * wp;
    gl_Position = projectionMatrix * viewMatrix * wp;
}`,
            fragmentShader: `
#include <common>
uniform sampler2D uNormalTex;
uniform sampler2D uReflTex;
uniform float uHasRefl;
uniform vec4 uCanoe;
uniform float uCanoeSpeed;
uniform vec4 uRipples[6];
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uBank;
varying vec3 vWorld;
varying vec4 vRiver;   // metres across, metres downstream, depth, white water from rocks
varying vec3 vFlow;    // downstream direction (xz), half width
varying vec4 vReflUv;

const float CANOE_LEN = ${CANOE_LEN.toFixed(2)};

vec2 waveSlope(vec2 uv) { return texture2D(uNormalTex, uv).xy * 2.0 - 1.0; }

void main() {
    vec3 p = vWorld;
    float t = uTime;

    // no water inside the hull
    vec2 fwd = vec2(-uCanoe.z, -uCanoe.w), right = vec2(uCanoe.w, -uCanoe.z);
    vec2 rel = p.xz - uCanoe.xy;
    float along = dot(rel, fwd), lat = dot(rel, right);
    float hs = along / CANOE_LEN + 0.5;
    if (hs > 0.0 && hs < 1.0 && abs(lat) < 0.46 * 0.86 * pow(sin(PI * hs), 0.62)) discard;

    float off = vRiver.x, depth = vRiver.z, rock = vRiver.w;
    vec2 flow = normalize(vFlow.xy), across = vec2(-flow.y, flow.x);
    float hw = vFlow.z;
    vec2 q = vRiver.xy;

    // ripples carried downstream; choppier in riffles and shallows
    vec2 s = waveSlope(q * 0.045 + vec2(0.0, -t * 0.075)) * 0.55
           + waveSlope(q * vec2(0.12, 0.09) + vec2(0.37, -t * 0.16)) * 0.4
           + waveSlope(q * 0.33 + vec2(0.71, -t * 0.4)) * 0.28;
    float chop = clamp(rock * 1.4 + (1.0 - smoothstep(0.2, 1.2, depth)) * 0.5, 0.0, 1.0);
    s *= 0.3 + 1.1 * chop;
    vec2 g = s.x * across + s.y * flow;

    // the canoe's V-shaped wake
    float speedK = clamp(uCanoeSpeed * 0.45, 0.0, 1.0);
    float db = CANOE_LEN * 0.5 - along;
    float wake = 0.0;
    if (db > 0.0 && db < 40.0) {
        float arm = abs(lat) - (0.3 + db * 0.32);
        float w = exp(-arm * arm * 6.0) * exp(-db * 0.09) * speedK;
        wake = w * 0.3;
        g += right * sign(lat) * sin(arm * 9.0 - t * 5.0) * w * 0.4;
        float tail = db - CANOE_LEN;
        if (tail > 0.0) wake += exp(-lat * lat * 3.0) * exp(-tail * 0.35) * speedK * 0.18;
    }
    // rings from paddle strokes
    float ringFoam = 0.0;
    for (int i = 0; i < 6; i++) {
        vec4 r = uRipples[i];
        float age = t - r.z;
        if (age < 0.0 || age > 3.5) continue;
        vec2 d = p.xz - r.xy;
        float dd = length(d), x = dd - age * 1.3;
        g += d / max(dd, 0.001) * sin(x * 16.0) * exp(-x * x * 5.0) * exp(-age * 1.1) * r.w * 0.5;
        ringFoam += exp(-x * x * 60.0) * exp(-age * 3.5) * r.w * 0.15;
    }

    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = normalize(cameraPosition - p);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 R = reflect(-V, N);

    vec3 refl;
    if (uHasRefl > 0.5) {
        vec4 ruv = vReflUv;
        ruv.xy += g * 0.035 * ruv.w;
        refl = texture2DProj(uReflTex, ruv).rgb;
    } else {
        // no reflection pass: sky, darkened where the reflected ray would hit the wooded banks
        vec3 skyCol = crSky(normalize(vec3(R.x, max(R.y, 0.0), R.z)));
        float rl = max(length(R.xz), 0.001);
        float toward = dot(R.xz / rl, across);
        float bankDist = max(toward > 0.0 ? hw - off : hw + off, 0.5) / max(abs(toward), 0.05);
        float hitsTrees = 1.0 - smoothstep(0.7, 1.3, R.y / rl * bankDist / 22.0);
        refl = mix(skyCol, uBank, hitsTrees);
    }

    float clarity = exp(-max(depth, 0.0) * 0.65);
    float sunK = max(dot(N, uSunDir), 0.0);
    vec3 body = mix(uDeep, uShallow, clarity) * (0.6 + 0.7 * sunK);
    float sp = max(dot(R, uSunDir), 0.0);
    vec3 spec = uSunCol * (pow(sp, 600.0) * 16.0 + pow(sp, 60.0) * 0.35);

    // white water around rocks, along the shore, and in the wake
    float shore = 1.0 - smoothstep(0.0, 0.15, depth);
    float amount = rock + shore * 0.25 * crNoise(q * vec2(0.4, 0.15)) + wake + ringFoam;
    float lace = crNoise(q * vec2(1.3, 0.55) + vec2(0.0, -t * 1.6)) * 0.55 + crNoise(q * vec2(3.7, 2.2) + vec2(0.0, -t * 3.4)) * 0.45;
    float foam = smoothstep(0.0, 0.3, amount * 1.2 - (1.0 - lace));

    vec3 col = mix(body, refl, fres) + spec * (1.0 - foam);
    float alpha = mix(0.84 - 0.7 * clarity, 1.0, fres);
    col = mix(col, vec3(0.88, 0.9, 0.88) * (0.45 + 0.75 * sunK), foam * 0.92);
    alpha = max(alpha, foam * 0.95) * smoothstep(0.0, 0.1, depth);

    gl_FragColor = vec4(crAtmosphere(col, p), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`
        }));
        water.frustumCulled = false;

        function buildWater() {
            const ACROSS = 36, STEP = high ? 0.9 : 1.3;
            const rows = Math.floor((RIVER.zMax - RIVER.zMin) / STEP) + 1;
            const pos = new Float32Array(rows * (ACROSS + 1) * 3);
            const riv = new Float32Array(rows * (ACROSS + 1) * 4);
            const flo = new Float32Array(rows * (ACROSS + 1) * 3);
            const sorted = foamRocks.slice().sort(function (a, b) { return a.z - b.z; });
            let dist = 0, prevX = riverX(RIVER.zMax), prevZ = RIVER.zMax;
            for (let i = 0; i < rows; i++) {
                const z0 = RIVER.zMax - i * STEP, cx = riverX(z0);
                dist += Math.hypot(cx - prevX, z0 - prevZ);
                prevX = cx;
                prevZ = z0;
                const s = riverSlope(z0), inv = 1 / Math.sqrt(1 + s * s), hw = riverHalfWidth(z0);
                // rocks that could throw foam onto this row
                const near = sorted.filter(function (r) { return Math.abs(r.z - z0) < 30; });
                for (let j = 0; j <= ACROSS; j++) {
                    const o = lerp(-(hw + 5), hw + 5, j / ACROSS);
                    const x = cx + o * inv, z = z0 - o * s * inv;
                    const v = i * (ACROSS + 1) + j;
                    pos[v * 3] = x;
                    pos[v * 3 + 2] = z;
                    let foam = 0;
                    for (const r of near) {
                        const dx = x - r.x, dz = z - r.z;
                        const dd = Math.sqrt(dx * dx + dz * dz);
                        if (dd > 26) continue;
                        const a = dx * r.fx + dz * r.fz, c = -dx * r.fz + dz * r.fx; // downstream of the rock, across
                        const collar = Math.exp(-Math.pow(Math.max(dd - r.r, 0) / 0.7, 2));
                        const trail = a > 0 ? Math.exp(-c * c / (r.r * r.r * (0.6 + a * 0.12))) * Math.exp(-a / (2.5 + r.r * 4)) : 0;
                        foam += (collar * 0.9 + trail * 0.8) * r.strength;
                    }
                    foam += riffle(z0) * 0.3 * smoothstep(0.0, 0.5, noise(x * 0.25, z * 0.12) + 0.2);
                    riv[v * 4] = o;
                    riv[v * 4 + 1] = dist;
                    riv[v * 4 + 2] = -terrainHeight(x, z);
                    riv[v * 4 + 3] = Math.min(foam, 1.2);
                    flo[v * 3] = -s * inv;
                    flo[v * 3 + 1] = -inv;
                    flo[v * 3 + 2] = hw;
                }
            }
            const index = new Uint32Array((rows - 1) * ACROSS * 6);
            let n = 0;
            for (let i = 0; i < rows - 1; i++) {
                for (let j = 0; j < ACROSS; j++) {
                    const a = i * (ACROSS + 1) + j, b = a + 1, c = a + ACROSS + 1, d = c + 1;
                    index[n++] = a; index[n++] = b; index[n++] = c;
                    index[n++] = b; index[n++] = d; index[n++] = c;
                }
            }
            const geo = water.geometry;
            geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
            geo.setAttribute("aRiver", new THREE.BufferAttribute(riv, 4));
            geo.setAttribute("aFlow", new THREE.BufferAttribute(flo, 3));
            geo.setIndex(new THREE.BufferAttribute(index, 1));
            scene.add(water);
        }

        // Planar reflection: render the scene from a camera mirrored in the water (y = 0)
        const reflCam = new THREE.PerspectiveCamera();
        const reflPlane = new THREE.Plane(), clip = new THREE.Vector4(), clipQ = new THREE.Vector4();
        const _look = new THREE.Vector3();
        function renderReflection() {
            reflCam.position.set(camera.position.x, -camera.position.y, camera.position.z);
            _look.set(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
            _look.y = -_look.y;
            reflCam.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
            reflCam.up.y = -reflCam.up.y;
            reflCam.lookAt(_look);
            reflCam.updateMatrixWorld();
            reflCam.projectionMatrix.copy(camera.projectionMatrix);
            waterUniforms.uTexMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
                .multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
            // oblique near plane, so nothing below the surface ends up in the reflection
            reflPlane.set(UP, 0).applyMatrix4(reflCam.matrixWorldInverse);
            clip.set(reflPlane.normal.x, reflPlane.normal.y, reflPlane.normal.z, reflPlane.constant);
            const pm = reflCam.projectionMatrix.elements;
            clipQ.set((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
            clip.multiplyScalar(2 / clip.dot(clipQ));
            pm[2] = clip.x;
            pm[6] = clip.y;
            pm[10] = clip.z + 1 - 0.003;
            pm[14] = clip.w;

            water.visible = false;
            for (const s of slices) if (s.noReflect) s.mesh.visible = false; // (none of these cast shadows)
            U.uReflect.value = 1;
            renderer.setRenderTarget(reflTarget);
            renderer.render(scene, reflCam);
            renderer.setRenderTarget(null);
            U.uReflect.value = 0;
            water.visible = true;
        }

        // ---------- landings ----------

        const propMat = atmos(new THREE.MeshLambertMaterial({ vertexColors: true }));
        const glowMat = atmos(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 0.95, 0.35) }));

        // Collects coloured primitives and merges them into one mesh
        function Kit() { this.parts = []; }
        Kit.prototype.add = function (geo, hex, x, y, z, rx, ry, rz, jitter) {
            const g = geo.index ? geo.toNonIndexed() : geo;
            if (g !== geo) geo.dispose();
            if (g.attributes.uv) g.deleteAttribute("uv");
            const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), _s.set(1, 1, 1));
            g.applyMatrix4(m);
            const c = color(hex), j = jitter === undefined ? 0.08 : jitter, k = 1 - j + rand() * j * 2;
            const n = g.attributes.position.count, col = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                col[i * 3] = c.r * k;
                col[i * 3 + 1] = c.g * k;
                col[i * 3 + 2] = c.b * k;
            }
            g.setAttribute("color", new THREE.BufferAttribute(col, 3));
            this.parts.push(g);
            return this;
        };
        Kit.prototype.box = function (w, h, d, hex, x, y, z, rx, ry, rz) {
            return this.add(new THREE.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz);
        };
        Kit.prototype.cyl = function (r, h, hex, x, y, z, rx, ry, rz, seg) {
            return this.add(new THREE.CylinderGeometry(r, r, h, seg || 8), hex, x, y, z, rx, ry, rz);
        };
        Kit.prototype.build = function (material) {
            const mesh = new THREE.Mesh(mergeGeometries(this.parts), material || propMat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            return mesh;
        };

        // Triangle in the xy-plane, extruded along z (tents, gables)
        function prism(halfWidth, height, depth) {
            const shape = new THREE.Shape();
            shape.moveTo(-halfWidth, 0);
            shape.lineTo(halfWidth, 0);
            shape.lineTo(0, height);
            shape.closePath();
            const g = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false });
            g.translate(0, 0, -depth / 2);
            return g;
        }

        function woodCanvas(w, h) {
            const cv = document.createElement("canvas");
            cv.width = w;
            cv.height = h;
            const g = cv.getContext("2d");
            const grd = g.createLinearGradient(0, 0, 0, h);
            grd.addColorStop(0, "#6f4e31");
            grd.addColorStop(1, "#5a3d25");
            g.fillStyle = grd;
            g.fillRect(0, 0, w, h);
            for (let i = 0; i < 46; i++) {
                const y = rand() * h;
                g.strokeStyle = "rgba(30, 18, 8, " + (0.08 + rand() * 0.16) + ")";
                g.lineWidth = 1 + rand() * 2.5;
                g.beginPath();
                g.moveTo(0, y);
                g.bezierCurveTo(w * 0.3, y + (rand() - 0.5) * 14, w * 0.7, y + (rand() - 0.5) * 14, w, y + (rand() - 0.5) * 8);
                g.stroke();
            }
            g.strokeStyle = "rgba(25, 15, 5, 0.6)";
            g.lineWidth = 6;
            g.strokeRect(3, 3, w - 6, h - 6);
            return { canvas: cv, g: g };
        }

        // A routed wooden sign; the letters are painted cream with a dark carved edge
        function signMaterial(text, w, h, px) {
            const c = woodCanvas(w, h), g = c.g;
            let size = px;
            g.font = "700 " + size + "px Georgia, 'Times New Roman', serif";
            while (g.measureText(text).width > w * 0.86 && size > 12) {
                size -= 2;
                g.font = "700 " + size + "px Georgia, 'Times New Roman', serif";
            }
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillStyle = "rgba(15, 8, 0, 0.75)";
            g.fillText(text, w / 2 + 2, h / 2 + 4);
            g.fillStyle = "#efe1c1";
            g.fillText(text, w / 2, h / 2 + 2);
            const tex = new THREE.CanvasTexture(c.canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = maxAniso;
            return atmos(new THREE.MeshLambertMaterial({ map: tex }));
        }
        const woodMat = atmos(new THREE.MeshLambertMaterial({ color: color("#5e4128") }));

        function sign(text, w, h, depth, px) {
            const face = signMaterial(text, 512, Math.round(512 * h / w), px || 72);
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), [woodMat, woodMat, woodMat, woodMat, face, face]);
            mesh.castShadow = true;
            return mesh;
        }

        const smokeSources = [];
        const flames = [];
        let wheel = null;

        function buildSite(stop, site) {
            const group = new THREE.Group();
            group.position.set(site.x, PAD_HEIGHT, site.z);
            group.rotation.y = site.yaw;
            const k = new Kit();
            const deckY = DOCK_Y - PAD_HEIGHT;
            const ground = function (lx, lz) {
                const p = siteToWorld(site, lx, lz);
                return terrainHeight(p.x, p.z) - PAD_HEIGHT;
            };

            // dock: plank deck on two stringers and posts, from the bank out into the river
            for (let z = 10.8; z < 17.2; z += 0.19) k.box(1.9, 0.06, 0.17, "#8b6d4c", 3.9, deckY, z);
            k.box(0.1, 0.16, 6.6, "#5c4632", 3.15, deckY - 0.11, 14).box(0.1, 0.16, 6.6, "#5c4632", 4.65, deckY - 0.11, 14);
            for (const z of [11.2, 14, 16.9]) {
                for (const x of [3.05, 4.75]) k.cyl(0.11, 2.6, "#4f3c2b", x, deckY - 0.9, z);
            }
            k.cyl(0.11, 0.6, "#4f3c2b", 4.75, deckY + 0.3, 16.9); // mooring post
            // sign on two posts at the head of the dock
            k.box(0.12, 1.75, 0.12, "#4f3c2b", 0.15, 0.85, 10).box(0.12, 1.75, 0.12, "#4f3c2b", 2.65, 0.85, 10);
            const board = sign(stop.name.toUpperCase(), 2.7, 0.66, 0.08);
            board.position.set(1.4, 1.38, 10.02);
            group.add(board);

            if (stop.build === "camp") {
                k.add(prism(1.15, 1.65, 2.7), "#a9783f", -3.2, 0, 0.6);           // canvas tent
                k.add(prism(0.62, 0.95, 0.04), "#2a2118", -3.2, 0, 1.97, 0, 0, 0, 0); // its open door
                k.cyl(0.6, 0.03, "#2b2723", 0.9, 0.02, 3.6);                     // fire ring
                for (let i = 0; i < 9; i++) {
                    const a = i / 9 * Math.PI * 2;
                    k.add(new THREE.IcosahedronGeometry(0.17, 0), "#78756e", 0.9 + Math.cos(a) * 0.68, 0.08, 3.6 + Math.sin(a) * 0.68, rand(), rand(), rand());
                }
                for (let i = 0; i < 3; i++) k.cyl(0.06, 0.85, "#5a3e26", 0.9 + Math.cos(i * 2.1) * 0.18, 0.28, 3.6 + Math.sin(i * 2.1) * 0.18, Math.sin(i * 2.1) * 0.6, 0, -Math.cos(i * 2.1) * 0.6);
                k.cyl(0.22, 2.2, "#6e5236", 0.9, 0.2, 1.75, 0, 0, Math.PI / 2, 10);      // log benches
                k.cyl(0.22, 2.2, "#6e5236", 2.85, 0.2, 3.6, Math.PI / 2, 0, 0, 10);
                for (let i = 0; i < 7; i++) k.cyl(0.1, 0.55, "#7a5a3a", -1.1 + (i % 4) * 0.21, 0.1 + Math.floor(i / 4) * 0.19, -1.6, Math.PI / 2, 0, 0, 7); // firewood
                k.box(0.62, 0.38, 0.4, "#2f66a8", -1.2, 0.19, 2.4).box(0.64, 0.06, 0.42, "#e8e6df", -1.2, 0.41, 2.4); // cooler
                k.cyl(0.012, 3.0, "#3b2f24", -5.0, 1.3, 3.2, 0.35, 0, 0.12, 5);      // fishing rod against a tree
                // a few trees in the clearing
                addSiteTree(site, k, -6.5, ground(-6.5, -3), -3, "#cf6a22");
                addSiteTree(site, k, 5.5, ground(5.5, -5), -5, "#c9a227");
                const fire = new THREE.Group();
                fire.position.set(0.9, 0.15, 3.6);
                group.add(fire);
                flames.push(fire);
                smokeSources.push({ group: group, local: new THREE.Vector3(0.9, 0.9, 3.6), rate: 5, size: 1.4 });
            } else if (stop.build === "trail") {
                // Appalachian Trail style lean-to, open side toward the river
                k.box(4.4, 0.3, 3.1, "#7a5a3a", -2.5, 0.45, -1.5);
                for (let i = 0; i < 5; i++) k.cyl(0.16, 4.7, "#6b4d31", -2.5, 0.35 + i * 0.3, -3.0, 0, 0, Math.PI / 2, 8);
                for (let i = 0; i < 5; i++) {
                    k.cyl(0.15, 3.3, "#6b4d31", -4.65, 0.5 + i * 0.3, -1.5, Math.PI / 2, 0, 0, 8);
                    k.cyl(0.15, 3.3, "#6b4d31", -0.35, 0.5 + i * 0.3, -1.5, Math.PI / 2, 0, 0, 8);
                }
                k.box(5.3, 0.12, 3.95, "#4b3a2c", -2.5, 2.35, -1.45, -Math.atan2(1.15, 3.7), 0, 0); // roof
                k.cyl(0.12, 2.8, "#5c4330", -4.6, 1.4, 0.15).cyl(0.12, 2.8, "#5c4330", -0.4, 1.4, 0.15);
                // trail sign and a pack left by the post
                k.box(0.14, 2.7, 0.14, "#4f3c2b", 6.2, 1.35, 9.4);
                k.box(0.38, 0.6, 0.26, "#b5452e", 5.75, 0.3, 9.7, 0.1, 0.3, 0).cyl(0.09, 0.5, "#3f6b4a", 5.75, 0.68, 9.7, 0, 0.3, Math.PI / 2);
                const a1 = sign("◄ SHELTER", 1.3, 0.24, 0.05, 80), a2 = sign("SUMMIT 3.2 MI ►", 1.5, 0.24, 0.05, 80);
                a1.position.set(5.75, 2.35, 9.48);
                a2.position.set(6.6, 2.0, 9.48);
                a2.rotation.y = 0.25;
                group.add(a1, a2);
                addSiteTree(site, k, -6.8, ground(-6.8, 4), 4, "#c2571c", true);
                addSiteTree(site, k, 7.5, ground(7.5, 1), 1, "#d6b03e", true);
                addSiteTree(site, k, 1.5, ground(1.5, -7), -7, "#a63421", true);
            } else if (stop.build === "mill") {
                k.box(6.4, 0.8, 5.4, "#7d7a72", -2.6, 0.3, 2.0);                 // stone foundation
                k.box(6, 3.4, 5, "#6e4f35", -2.6, 2.4, 2.0);                     // board walls
                for (let x = -5.3; x < 0.3; x += 0.6) k.box(0.07, 3.4, 0.05, "#5a3f2a", x, 2.4, 4.52);
                k.box(1.0, 2.0, 0.06, "#3b2a1d", -3.8, 1.75, 4.53);              // door and windows
                k.box(0.85, 0.9, 0.06, "#2a2622", -1.4, 2.6, 4.53).box(0.85, 0.9, 0.06, "#2a2622", -5.6, 3.2, -0.53 + 0.01);
                k.add(prism(2.5, 1.6, 6), "#6e4f35", -2.6, 4.1, 2.0, 0, Math.PI / 2, 0); // gable
                const slope = Math.atan2(1.6, 2.5), run = 2.85 / Math.cos(slope);
                k.box(6.8, 0.12, run, "#4d3d30", -2.6, 4.95, 2.0 + 1.42, slope, 0, 0);
                k.box(6.8, 0.12, run, "#4d3d30", -2.6, 4.95, 2.0 - 1.42, -slope, 0, 0);
                k.cyl(0.6, 0.25, "#8b877d", -6.2, 0.6, 4.7, 0.2, 0, Math.PI / 2, 16);  // spare millstone
                // flume on trestles bringing water from up the hill to the top of the wheel
                const flumeZ0 = 1.0, flumeZ1 = -15;
                const fl = flumeZ0 - flumeZ1, fy = function (z) { return 5.1 + (flumeZ0 - z) * 0.03; };
                const tilt = Math.atan2(0.03 * fl, fl);
                k.box(0.75, 0.08, fl, "#5e4630", 1.2, fy((flumeZ0 + flumeZ1) / 2), (flumeZ0 + flumeZ1) / 2, tilt, 0, 0);
                k.box(0.06, 0.42, fl, "#5e4630", 0.85, fy((flumeZ0 + flumeZ1) / 2) + 0.2, (flumeZ0 + flumeZ1) / 2, tilt, 0, 0);
                k.box(0.06, 0.42, fl, "#5e4630", 1.55, fy((flumeZ0 + flumeZ1) / 2) + 0.2, (flumeZ0 + flumeZ1) / 2, tilt, 0, 0);
                k.box(0.6, 0.05, fl, "#7b98a6", 1.2, fy((flumeZ0 + flumeZ1) / 2) + 0.09, (flumeZ0 + flumeZ1) / 2, tilt, 0, 0);
                for (let z = flumeZ0 - 2; z > flumeZ1 + 1; z -= 3) {
                    const top = fy(z), base = Math.min(ground(1.2, z), top - 0.5);
                    const h = top - base + 0.5;
                    k.box(0.12, h, 0.12, "#4f3c2b", 0.85, base + h / 2 - 0.5, z).box(0.12, h, 0.12, "#4f3c2b", 1.55, base + h / 2 - 0.5, z);
                }
                k.box(0.55, 1.1, 0.05, "#cfe3ea", 1.2, 4.6, 1.15);                 // water spilling onto the wheel
                k.cyl(0.08, 2.2, "#3a3a3a", 0.2, 2.5, 2.0, 0, 0, Math.PI / 2);       // axle
                // overshot waterwheel, turned in the update loop
                const w = new Kit();
                for (const x of [-0.45, 0.45]) {
                    w.add(new THREE.TorusGeometry(2.3, 0.07, 6, 40), "#5b4330", x, 0, 0, 0, Math.PI / 2, 0);
                    w.add(new THREE.TorusGeometry(1.75, 0.05, 6, 32), "#5b4330", x, 0, 0, 0, Math.PI / 2, 0);
                    for (let i = 0; i < 4; i++) w.box(0.08, 4.6, 0.1, "#5b4330", x, 0, 0, i * Math.PI / 4, 0, 0);
                }
                for (let i = 0; i < 24; i++) {
                    const a = i / 24 * Math.PI * 2;
                    w.box(0.95, 0.06, 0.55, "#6b5038", 0, Math.cos(a) * 2.02, Math.sin(a) * 2.02, -a + Math.PI / 2, 0, 0);
                }
                w.cyl(0.28, 1.2, "#4a3828", 0, 0, 0, 0, 0, Math.PI / 2, 10);
                wheel = w.build();
                wheel.position.set(1.2, 2.55, 2.0);
                group.add(wheel);
                addSiteTree(site, k, -8, ground(-8, -4), -4, "#cf6a22");
                addSiteTree(site, k, 7, ground(7, -3), -3, "#a63421");
            } else if (stop.build === "cabin") {
                k.box(6.4, 0.4, 5.0, "#6f6a62", -2, 0.2, 0);                       // stone piers
                k.box(6.2, 3.0, 4.8, "#b5ad9a", -2, 1.95, 0);                      // chinking between the logs
                for (let i = 0; i < 9; i++) {
                    const y = 0.55 + i * 0.34;
                    k.cyl(0.18, 6.9, "#7a5634", -2, y, 2.45, 0, 0, Math.PI / 2, 9).cyl(0.18, 6.9, "#7a5634", -2, y, -2.45, 0, 0, Math.PI / 2, 9);
                    k.cyl(0.18, 5.5, "#7a5634", -5.25, y + 0.17, 0, Math.PI / 2, 0, 0, 9).cyl(0.18, 5.5, "#7a5634", 1.25, y + 0.17, 0, Math.PI / 2, 0, 0, 9);
                }
                k.add(prism(2.65, 1.7, 6.6), "#6b4a2e", -2, 3.45, 0, 0, Math.PI / 2, 0);
                const slope = Math.atan2(1.7, 2.6), run = 3.2 / Math.cos(slope);
                k.box(7.6, 0.1, run, "#7d3b2a", -2, 4.3, 1.6, slope, 0, 0);          // rusty tin roof
                k.box(7.6, 0.1, run, "#7d3b2a", -2, 4.3, -1.6, -slope, 0, 0);
                k.box(0.95, 6.0, 0.95, "#7a7468", -5.85, 3.0, 0).box(1.05, 0.15, 1.05, "#66615a", -5.85, 6.05, 0); // chimney
                k.box(6.9, 0.15, 2.0, "#8a6a48", -2, 0.45, 3.5);                     // porch
                for (const x of [-5.2, -3.1, -0.9, 1.2]) k.cyl(0.08, 2.4, "#6b4d31", x, 1.7, 4.35);
                k.box(7.1, 0.1, 2.3, "#7d3b2a", -2, 2.95, 3.6, 0.2, 0, 0);
                k.box(1.4, 0.16, 0.45, "#7a5a3a", -2, 0.3, 4.7).box(1.4, 0.16, 0.45, "#7a5a3a", -2, 0.12, 5.1);
                k.box(0.9, 1.9, 0.06, "#3d2b1e", -2, 1.5, 2.66);                     // door
                k.box(1.3, 0.12, 0.45, "#6b4d31", -0.6, 0.85, 3.2).box(1.3, 0.5, 0.06, "#6b4d31", -0.6, 1.1, 2.98); // porch bench
                for (const x of [-4.1, 0.1]) k.box(1.0, 1.0, 0.08, "#4a3524", x, 1.75, 2.66);
                const windows = new Kit();
                for (const x of [-4.1, 0.1]) windows.box(0.8, 0.8, 0.06, "#ffffff", x, 1.75, 2.7);
                windows.box(0.08, 0.15, 0.08, "#ffffff", 4.75, deckY + 0.68, 16.9);   // lantern on the mooring post
                group.add(windows.build(glowMat));
                // mailbox with its flag up
                k.box(0.1, 1.15, 0.1, "#4f3c2b", 5.9, 0.57, 9.7).box(0.27, 0.22, 0.5, "#5a5f66", 5.9, 1.22, 9.7);
                k.cyl(0.135, 0.5, "#5a5f66", 5.9, 1.33, 9.7, Math.PI / 2, 0, 0, 12).box(0.03, 0.24, 0.06, "#b3271e", 6.06, 1.42, 9.55);
                addSiteTree(site, k, -8.5, ground(-8.5, 3), 3, "#d6b03e");
                addSiteTree(site, k, 4.5, ground(4.5, -6), -6, "#c2571c");
                smokeSources.push({ group: group, local: new THREE.Vector3(-5.85, 6.3, 0), rate: 3, size: 1.8 });
            }
            group.add(k.build());
            scene.add(group);

            const tip = siteToWorld(site, 3.9, 17);
            for (let z = 11.5; z <= 17.2; z += 1.1) {
                const p = siteToWorld(site, 3.9, z);
                obstacles.push({ x: p.x, z: p.z, r: 0.95 });
            }
            const label = siteToWorld(site, 1.4, 10);
            return { tip: tip, label: new THREE.Vector3(label.x, PAD_HEIGHT + 3.2, label.z) };
        }

        // A full-size tree for a clearing (the forest stays out of them), planted along with the forest's
        // instanced trees once every landing is built. x, y, z are in the landing's frame.
        const siteTrees = [];
        function addSiteTree(site, k, x, y, z, leafHex, blaze) {
            if (blaze) k.box(0.13, 0.26, 0.04, "#f1f1ea", x, y + 1.8, z + 0.36); // white trail blaze
            const p = siteToWorld(site, x, z);
            siteTrees.push({
                z: p.z, c: color(leafHex),
                m: new THREE.Matrix4().compose(_p.set(p.x, y + PAD_HEIGHT - 0.3, p.z), _q.setFromAxisAngle(UP, rand() * Math.PI * 2), _s.set(1.05, 1.05, 1.05))
            });
        }

        // ---------- canoe and paddler ----------

        function canoeHalfBeam(s) { return 0.46 * Math.pow(Math.max(Math.sin(Math.PI * s), 0), 0.62); }
        function canoeKeel(s) { const e = Math.abs(2 * s - 1); return -0.15 + 0.12 * e * e * e; }
        function canoeSheer(s) { return 0.2 + 0.32 * Math.pow(Math.abs(2 * s - 1), 5); }

        const canoe = new THREE.Group();
        canoe.rotation.order = "YXZ";
        const paddler = {};

        function buildCanoe() {
            // hull lofted from elliptical cross-sections; s runs stern (0) to bow (1)
            const NS = 40, NT = 16, pos = [], index = [];
            for (let i = 0; i <= NS; i++) {
                const s = i / NS, z = (0.5 - s) * CANOE_LEN;
                const b = Math.max(canoeHalfBeam(s), 0.004), kl = canoeKeel(s), h = canoeSheer(s);
                for (let j = 0; j <= NT; j++) {
                    const phi = (j / NT * 2 - 1) * Math.PI / 2;
                    pos.push(b * Math.sin(phi), kl + (h - kl) * Math.pow(1 - Math.cos(phi), 1.25), z);
                }
            }
            for (let i = 0; i < NS; i++) {
                for (let j = 0; j < NT; j++) {
                    const a = i * (NT + 1) + j, b = a + NT + 1;
                    index.push(a, b, a + 1, a + 1, b, b + 1);
                }
            }
            const hullGeo = new THREE.BufferGeometry();
            hullGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
            hullGeo.setIndex(index);
            hullGeo.computeVertexNormals();
            const hull = new THREE.Mesh(hullGeo, atmos(new THREE.MeshStandardMaterial({ color: color("#a1281f"), roughness: 0.42, side: THREE.DoubleSide })));
            hull.castShadow = true;
            hull.receiveShadow = true;
            canoe.add(hull);

            const k = new Kit();
            for (const side of [-1, 1]) {
                const pts = [];
                for (let i = 0; i <= 24; i++) {
                    const s = 0.01 + i / 24 * 0.98;
                    pts.push(new THREE.Vector3(side * canoeHalfBeam(s), canoeSheer(s) + 0.01, (0.5 - s) * CANOE_LEN));
                }
                k.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.024, 5, false), "#b08a5c", 0, 0, 0, 0, 0, 0, 0);
            }
            for (const seat of [[0.2, 0.1], [0.5, 0.17], [0.8, 0.12]]) {
                const s = seat[0], w = canoeHalfBeam(s) * 2 * 0.95;
                k.box(w, 0.035, seat[0] === 0.5 ? 0.08 : 0.24, "#a98458", 0, seat[1], (0.5 - s) * CANOE_LEN);
            }
            k.cyl(0.17, 0.5, "#d9a21b", 0, 0.02, -1.1, 0, 0.4, Math.PI / 2, 12); // dry bag in the bow
            canoe.add(k.build());

            // A few pieces of gear give the boat the feeling of an actual day on the river.
            const gear = new Kit();
            gear.box(0.025, 0.025, 0.53, "#504838", 0, 0.20, -1.1, 0, 0.4, 0);
            gear.box(0.32, 0.025, 0.025, "#504838", 0, 0.20, -1.1, 0, 0.4, 0);
            // A coiled painter at the bow and small brass fasteners along the gunwales.
            gear.add(new THREE.TorusGeometry(0.105, 0.012, 6, 20), "#d9c59c", 0, 0.17, -1.8, Math.PI / 2, 0, 0, 0);
            for (const side of [-1, 1]) for (const s of [0.18, 0.35, 0.5, 0.65, 0.82]) {
                gear.add(new THREE.SphereGeometry(0.018, 6, 4), "#d4b878", side * canoeHalfBeam(s), canoeSheer(s) + 0.025, (0.5 - s) * CANOE_LEN, 0, 0, 0, 0);
            }
            canoe.add(gear.build());

            // The paddler is built in layers so the life jacket, clothing and head read as a
            // person even from the usual view behind the canoe. The arms remain separately rigged.
            const skin = atmos(new THREE.MeshStandardMaterial({ color: color("#c99778"), roughness: 0.9 }));
            const pfd = atmos(new THREE.MeshStandardMaterial({ color: color("#be6036"), roughness: 0.85 }));
            const pfdDark = atmos(new THREE.MeshStandardMaterial({ color: color("#803e2d"), roughness: 0.9 }));
            const shirt = atmos(new THREE.MeshStandardMaterial({ color: color("#b6aa89"), roughness: 1 }));
            const pants = atmos(new THREE.MeshStandardMaterial({ color: color("#414b4b"), roughness: 1 }));
            const boots = atmos(new THREE.MeshStandardMaterial({ color: color("#66503d"), roughness: 1 }));
            const hair = atmos(new THREE.MeshStandardMaterial({ color: color("#574433"), roughness: 1 }));
            const hat = atmos(new THREE.MeshStandardMaterial({ color: color("#8c7a56"), roughness: 1 }));
            const wood = atmos(new THREE.MeshStandardMaterial({ color: color("#b98f5c"), roughness: 0.7 }));
            const limb = function (r, mat) {
                const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, 1, 10), mat);
                m.castShadow = true;
                canoe.add(m);
                return m;
            };
            const upper = new THREE.Group();
            upper.rotation.order = "YXZ";
            upper.position.set(0, 0.17, PADDLER_Z);
            function part(geometry, material, x, y, z, sx, sy, sz) {
                const m = new THREE.Mesh(geometry, material);
                m.position.set(x, y, z);
                m.scale.set(sx || 1, sy || 1, sz || 1);
                m.castShadow = true;
                upper.add(m);
                return m;
            }
            // Shirt and softly rounded jacket panels, with seams and straps visible from behind.
            part(new THREE.SphereGeometry(1, 20, 14), shirt, 0, 0.31, 0, 0.215, 0.30, 0.13);
            part(new THREE.SphereGeometry(1, 20, 14), pfd, 0, 0.30, 0.015, 0.205, 0.255, 0.145);
            part(new THREE.BoxGeometry(0.30, 0.025, 0.018), pfdDark, 0, 0.22, 0.155);
            part(new THREE.BoxGeometry(0.30, 0.025, 0.018), pfdDark, 0, 0.39, 0.15);
            part(new THREE.BoxGeometry(0.055, 0.04, 0.022), hat, 0, 0.22, 0.167);
            part(new THREE.BoxGeometry(0.055, 0.04, 0.022), hat, 0, 0.39, 0.162);
            part(new THREE.CylinderGeometry(0.07, 0.085, 0.11, 12), skin, 0, 0.60, -0.01);
            part(new THREE.SphereGeometry(1, 20, 16), skin, 0, 0.72, -0.02, 0.115, 0.145, 0.105);
            // Hair at the back, ears and a subtle nose give the head shape in profile.
            part(new THREE.SphereGeometry(1, 16, 12), hair, 0, 0.755, 0.025, 0.111, 0.105, 0.075);
            for (const side of [-1, 1]) {
                part(new THREE.SphereGeometry(1, 10, 8), skin, side * 0.112, 0.715, -0.02, 0.025, 0.035, 0.022);
            }
            part(new THREE.SphereGeometry(1, 10, 8), skin, 0, 0.715, -0.125, 0.027, 0.035, 0.035);
            part(new THREE.CylinderGeometry(0.19, 0.20, 0.018, 24), hat, 0, 0.82, -0.02);
            part(new THREE.CylinderGeometry(0.105, 0.125, 0.105, 20), hat, 0, 0.875, -0.02);
            part(new THREE.CylinderGeometry(0.113, 0.115, 0.018, 20), pfdDark, 0, 0.835, -0.02);
            canoe.add(upper);
            for (const side of [-1, 1]) {
                const hip = new THREE.Vector3(side * 0.1, 0.17, PADDLER_Z), knee = new THREE.Vector3(side * 0.15, 0.36, PADDLER_Z - 0.42);
                const foot = new THREE.Vector3(side * 0.13, 0.04, PADDLER_Z - 0.8);
                orient(limb(0.09, pants), hip, knee);
                orient(limb(0.065, pants), knee, foot);
                const shoe = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), boots);
                shoe.position.copy(foot).add(new THREE.Vector3(0, 0.015, -0.06));
                shoe.scale.set(0.075, 0.055, 0.14);
                shoe.castShadow = true;
                canoe.add(shoe);
            }
            const paddle = new THREE.Group();
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.04, 10), wood);
            shaft.position.y = -0.52;
            const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.10, 4, 8), wood);
            grip.rotation.z = Math.PI / 2;
            // A tapered, round-ended blade instead of a rectangular plank.
            const bladeShape = new THREE.Shape();
            bladeShape.moveTo(-0.035, -0.94);
            bladeShape.bezierCurveTo(-0.10, -1.04, -0.12, -1.20, -0.095, -1.38);
            bladeShape.quadraticCurveTo(0, -1.48, 0.095, -1.38);
            bladeShape.bezierCurveTo(0.12, -1.20, 0.10, -1.04, 0.035, -0.94);
            bladeShape.closePath();
            const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 8 }), wood);
            blade.position.z = -0.009;
            for (const m of [shaft, grip, blade]) {
                m.castShadow = true;
                paddle.add(m);
            }
            canoe.add(paddle);
            Object.assign(paddler, {
                upper: upper, paddle: paddle,
                arms: [-1, 1].map(function (side) {
                    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), skin);
                    hand.castShadow = true;
                    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 8), shirt);
                    elbow.castShadow = true;
                    canoe.add(hand, elbow);
                    return { side: side, upper: limb(0.062, shirt), fore: limb(0.047, skin), hand: hand, elbow: elbow };
                })
            });
            scene.add(canoe);
        }

        const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
        const _m = new THREE.Matrix4();
        // Stretch a unit-height cylinder between two points
        function orient(mesh, from, to) {
            _a.subVectors(to, from);
            const len = _a.length();
            mesh.position.copy(from).add(to).multiplyScalar(0.5);
            mesh.quaternion.setFromUnitVectors(UP, _a.divideScalar(len || 1));
            mesh.scale.set(1, len, 1);
        }
        // Two-bone arm: elbow found from the bone lengths, bending toward `pole`
        function solveArm(arm, shoulder, hand, pole) {
            const A = 0.31, B = 0.31;
            _b.subVectors(hand, shoulder);
            const dist = clamp(_b.length(), 0.05, A + B - 0.001);
            _b.normalize();
            const cosA = clamp((A * A + dist * dist - B * B) / (2 * A * dist), -1, 1);
            _c.copy(pole).addScaledVector(_b, -pole.dot(_b)).normalize();
            const elbow = _d.copy(shoulder).addScaledVector(_b, cosA * A).addScaledVector(_c, Math.sqrt(1 - cosA * cosA) * A);
            orient(arm.upper, shoulder, elbow);
            orient(arm.fore, elbow, hand);
            arm.hand.position.copy(hand);
            arm.elbow.position.copy(elbow);
        }

        // ---------- particles: smoke, spray, and leaves ----------

        function particleSystem(max, tint, additive) {
            const geo = new THREE.BufferGeometry();
            const pos = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
            geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
            geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
            geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
            const mat = new THREE.ShaderMaterial({
                uniforms: Object.assign({ uScale: { value: 400 }, uTint: { value: color(tint) } }, U),
                transparent: true,
                depthWrite: false,
                blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
                vertexShader: `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
varying vec3 vWorld;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vAlpha = aAlpha;
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
}`,
                fragmentShader: `
#include <common>
uniform vec3 uTint;
varying float vAlpha;
varying vec3 vWorld;
void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * vAlpha;
    if (a < 0.004) discard;
    vec3 col = uTint * (0.7 + 0.4 * uSunCol);
    gl_FragColor = vec4(crAtmosphere(col, vWorld), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`
            });
            const points = new THREE.Points(geo, mat);
            points.frustumCulled = false;
            scene.add(points);
            const list = [];
            return {
                material: mat,
                spawn: function (p) { if (list.length < max) list.push(p); },
                update: function (dt) {
                    let n = 0;
                    for (let i = list.length - 1; i >= 0; i--) {
                        const p = list[i];
                        p.age += dt;
                        if (p.age >= p.life) {
                            list[i] = list[list.length - 1];
                            list.pop();
                        }
                    }
                    for (const p of list) {
                        p.vy -= p.grav * dt;
                        p.x += p.vx * dt;
                        p.y += p.vy * dt;
                        p.z += p.vz * dt;
                        const t = p.age / p.life;
                        pos[n * 3] = p.x;
                        pos[n * 3 + 1] = p.y;
                        pos[n * 3 + 2] = p.z;
                        size[n] = lerp(p.s0, p.s1, t);
                        alpha[n] = p.a * Math.min(1, t * 6) * (1 - t);
                        n++;
                    }
                    geo.setDrawRange(0, n);
                    geo.attributes.position.needsUpdate = true;
                    geo.attributes.aSize.needsUpdate = true;
                    geo.attributes.aAlpha.needsUpdate = true;
                }
            };
        }

        const leafCount = high ? 320 : 160;
        const leafGeo = (function () {
            const s = new THREE.Shape();
            s.moveTo(0, -0.1);
            s.quadraticCurveTo(0.085, -0.02, 0, 0.1);
            s.quadraticCurveTo(-0.085, -0.02, 0, -0.1);
            const g = new THREE.ShapeGeometry(s, 3);
            g.deleteAttribute("uv");
            return g;
        })();
        const leafMesh = new THREE.InstancedMesh(leafGeo, atmos(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })), leafCount);
        leafMesh.frustumCulled = false;
        const leaves = [];

        // ---------- build it all ----------

        // yield between the heavier steps so the page keeps scrolling smoothly while the river is built
        const breathe = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
        buildTerrain();
        await breathe();
        buildRidges();
        buildRocks();
        await breathe();
        buildForest();
        await breathe();
        const stopsInfo = STOPS.map(function (stop, i) { return buildSite(stop, SITES[i]); });
        instanced(siteTrees, TREE.hardCrown, leafMat, true, crownSetup, 500);
        instanced(siteTrees, TREE.hardTrunk, barkMat, true, trunkSetup, 250);
        await breathe();
        buildWater(); // after the rocks and docks, which it needs for white water
        buildCanoe();
        const smoke = particleSystem(140, "#9a9893", false);
        const spray = particleSystem(80, "#e8eef0", false);
        const flameGlow = particleSystem(60, "#ff9a3c", true);
        for (let i = 0; i < leafCount; i++) {
            leaves.push({ x: 0, y: 0, z: 0, state: "air", phase: rand() * 10, spin: 0.5 + rand() * 2, fall: 0.5 + rand() * 0.7, rot: rand() * 6 });
            leafMesh.setColorAt(i, color(pick(rand() < 0.5 ? LEAVES.orange : rand() < 0.5 ? LEAVES.yellow : LEAVES.red)));
        }
        scene.add(leafMesh);
        const obstacleSlices = new Map(); // obstacles bucketed by 10 m of z for quick lookups
        for (const o of obstacles) {
            const k = Math.floor(o.z / 10);
            if (!obstacleSlices.has(k)) obstacleSlices.set(k, []);
            obstacleSlices.get(k).push(o);
        }

        // ---------- game state ----------

        const boat = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, w: 0, speed: 0 };
        const stroke = { phase: 0, side: 1, sideS: 1, act: 0, reverse: 0, wasIn: false };
        const keys = { forward: false, back: false, left: false, right: false };
        const cam = { yaw: 0, dragYaw: 0, dragPitch: 0, lastLook: -10 };
        let started = false, active = false, raf = 0, lastTime = 0, time = 0;
        let manualTimer = 0, thrS = 0, steerS = 0, pullS = 0, bump = 0, holdTime = 0, boost = 1;
        let currentStop = -1, busy = false;

        function currentAt(x, z) {
            const s = riverSlope(z), inv = 1 / Math.sqrt(1 + s * s), hw = riverHalfWidth(z);
            const o = clamp((x - riverX(z)) * inv / hw, -1, 1);
            const speed = (CURRENT + 1.0 * riffle(z)) * (1 - 0.5 * o * o);
            return { x: -s * inv * speed, z: -inv * speed };
        }

        function placeBoat(z, x) {
            boat.z = z;
            boat.x = x === undefined ? riverX(z) : x;
            boat.yaw = riverYaw(z);
            const c = currentAt(boat.x, boat.z);
            boat.vx = c.x;
            boat.vz = c.z;
            boat.w = 0;
            cam.yaw = boat.yaw;
            scatterLeaves();
        }

        // Pushes the hull out of banks, boulders and docks, swinging it away from what it hit
        const HULL = [[2.2, 0.18], [1.1, 0.38], [0, 0.45], [-1.1, 0.38], [-2.2, 0.18]]; // [metres toward bow, half beam]
        function collide() {
            for (let iter = 0; iter < 2; iter++) {
                const fx = -Math.sin(boat.yaw), fz = -Math.cos(boat.yaw), rx = Math.cos(boat.yaw), rz = -Math.sin(boat.yaw);
                for (const pt of HULL) {
                    const a = pt[0], hb = pt[1];
                    const px = boat.x + fx * a, pz = boat.z + fz * a;
                    const s = riverSlope(pz), inv = 1 / Math.sqrt(1 + s * s);
                    const o = (px - riverX(pz)) * inv, lim = riverHalfWidth(pz) - 0.35 - hb;
                    if (Math.abs(o) > lim) {
                        const sg = Math.sign(o);
                        push(-sg * inv, sg * s * inv, Math.abs(o) - lim, a, rx, rz);
                    }
                    const k = Math.floor(pz / 10);
                    for (let kk = k - 1; kk <= k + 1; kk++) {
                        const list = obstacleSlices.get(kk);
                        if (!list) continue;
                        for (const ob of list) {
                            const dx = px - ob.x, dz = pz - ob.z, rr = ob.r + hb;
                            const d2 = dx * dx + dz * dz;
                            if (d2 < rr * rr) {
                                const d = Math.sqrt(d2) || 0.001, nx = dx / d, nz = dz / d, pen = rr - d;
                                push(nx, nz, pen, a, rx, rz);
                                // slide round it on the side the hull is already on (or downstream, alongside it),
                                // so the current can't pin the canoe against a rock
                                const side = dx - dz * s < 0 ? -1 : 1;
                                const flip = (-nz - nx * s) * side + 0.3 * (nz * s - nx) < 0 ? -1 : 1;
                                boat.x -= nz * flip * pen * 0.6;
                                boat.z += nx * flip * pen * 0.6;
                            }
                        }
                    }
                }
            }
        }
        function push(nx, nz, pen, a, rx, rz) {
            boat.x += nx * pen;
            boat.z += nz * pen;
            const vn = boat.vx * nx + boat.vz * nz;
            if (vn < 0) {
                boat.vx -= nx * vn * 1.25;
                boat.vz -= nz * vn * 1.25;
                bump = Math.max(bump, Math.min(1, -vn * 0.6));
            }
            boat.w -= a * (rx * nx + rz * nz) * pen * 3;
        }

        function stepBoat(dt, thr, steer, power, pull) {
            const fx = -Math.sin(boat.yaw), fz = -Math.cos(boat.yaw), rx = Math.cos(boat.yaw), rz = -Math.sin(boat.yaw);
            const c = currentAt(boat.x, boat.z);
            if (pull > 0) {
                // left to drift, the canoe works its way out to the middle of the channel, clear of the rocks
                const s = riverSlope(boat.z), inv = 1 / Math.sqrt(1 + s * s);
                const k = -0.08 * pull * (boat.x - riverX(boat.z)) * inv;
                c.x += k * inv;
                c.z -= k * s * inv;
            }
            const relX = boat.vx - c.x, relZ = boat.vz - c.z;
            const along = relX * fx + relZ * fz, lat = relX * rx + relZ * rz;
            // boost 2 takes about 4.3x the thrust to double the top speed against the drag below
            const thrust = thr * (thr > 0 ? 1.9 * Math.pow(boost, 2.1) : 1.6) * power;
            const aAlong = thrust - 0.3 * along - 0.09 * along * Math.abs(along);
            const aLat = -2.2 * lat; // the hull resists sliding sideways
            boat.vx += (fx * aAlong + rx * aLat) * dt;
            boat.vz += (fz * aAlong + rz * aLat) * dt;
            // steering bites harder with way on; with no input the hull slowly settles into the current
            const bite = 0.45 + 0.55 * Math.min(1, Math.abs(along) / 2);
            const settle = steer === 0 ? wrapAngle(riverYaw(boat.z) - boat.yaw) * 0.25 : 0;
            boat.w += (steer * 1.5 * bite + settle - 1.9 * boat.w) * dt;
            boat.yaw += boat.w * dt;
            boat.x += boat.vx * dt;
            boat.z += boat.vz * dt;
            collide();
            boat.speed = Math.max(0, along);
        }

        // Before Start: holds the centre of the channel (where no boulders sit) at an easy pace
        function autopilotInput() {
            const look = 14 + 2.5 * Math.hypot(boat.vx, boat.vz);
            const p = riverPoint(boat.z - look, 0);
            const desired = Math.atan2(-(p.x - boat.x), -(p.z - boat.z));
            return { thr: 0.3, steer: clamp(wrapAngle(desired - boat.yaw) * 2.4 - boat.w * 0.8, -1, 1) };
        }

        // Paddle stroke: a power phase in the water, then the blade feathers and swings forward
        function strokePower() {
            return stroke.phase < 0.6 ? 0.35 + 0.65 * Math.sin(Math.PI * stroke.phase / 0.6) / 0.382 : 0.35;
        }

        const _shoulder = new THREE.Vector3(), _grip = new THREE.Vector3(), _bladeT = new THREE.Vector3(), _dir = new THREE.Vector3();
        const _low = new THREE.Vector3(), _pole = new THREE.Vector3(), _bx = new THREE.Vector3(), _bz = new THREE.Vector3(), _blade = new THREE.Vector3();
        const _rest = new THREE.Vector3(), _restGrip = new THREE.Vector3(), _handTarget = new THREE.Vector3();

        function posePaddler() {
            const sg = stroke.sideS, act = stroke.act, ph = stroke.phase;
            // Ease both ends of the pull and recovery, so position and velocity join up
            // at the catch and exit. Keep the hands within a comfortable seated reach.
            let bz, by, bx, feather, prog;
            if (ph < 0.6) {
                const p = ph / 0.6;
                prog = p * p * (3 - 2 * p);
                bz = lerp(-0.55, 0.35, prog);
                by = -0.30;
                bx = 0.66;
                feather = 0;
            } else {
                const r = (ph - 0.6) / 0.4, e = r * r * (3 - 2 * r);
                prog = 1 - e;
                bz = lerp(0.35, -0.55, e);
                // A raised, feathered recovery, with zero velocity at either end.
                const lift = Math.pow(Math.sin(Math.PI * r), 2);
                by = -0.30 + 0.48 * lift;
                bx = 0.66 + 0.07 * lift;
                feather = lift;
            }
            bz = lerp(bz, -0.2 - bz, stroke.reverse);
            _bladeT.set(sg * bx, by, PADDLER_Z + bz);
            _grip.set(sg * 0.10, 0.91 - 0.10 * prog, PADDLER_Z - 0.18 + bz * 0.22);
            _rest.set(sg * 0.72, 0.16, PADDLER_Z - 0.15);
            _restGrip.set(-sg * 0.20, 0.53, PADDLER_Z - 0.18);
            _bladeT.lerp(_rest, 1 - act);
            _grip.lerp(_restGrip, 1 - act);
            _dir.subVectors(_bladeT, _grip).normalize();

            // Rotate the shoulders with the torso rather than swinging the whole body
            // abruptly at the ends of a stroke.
            const up = paddler.upper;
            up.rotation.y = sg * act * (0.22 - 0.38 * prog);
            up.rotation.x = -0.08 - 0.12 * act * (1 - prog);
            up.rotation.z = -sg * 0.035 * act;
            up.updateMatrix();

            // The hands stay on the same shaft while it feathers during recovery.
            const P = paddler.paddle;
            P.position.copy(_grip);
            const yAxis = _a.copy(_dir).negate();
            _bz.set(sg * Math.sin(feather * 1.15), 0, Math.cos(feather * 1.15));
            _bz.addScaledVector(yAxis, -_bz.dot(yAxis)).normalize();
            _bx.crossVectors(yAxis, _bz).normalize();
            _m.makeBasis(_bx, yAxis, _bz);
            P.quaternion.setFromRotationMatrix(_m);
            _low.copy(_grip).addScaledVector(_dir, 0.50);

            // When changing sides, exchange grips continuously instead of teleporting
            // both hands as soon as the paddle crosses the centre of the canoe.
            const rightTop = smoothstep(-0.85, 0.85, -sg);
            for (const arm of paddler.arms) {
                _shoulder.set(arm.side * 0.19, 0.50, 0).applyMatrix4(up.matrix);
                const topWeight = arm.side > 0 ? rightTop : 1 - rightTop;
                _handTarget.copy(_low).lerp(_grip, topWeight);
                _pole.set(arm.side * 0.75, -0.7, 0.25).transformDirection(up.matrix);
                solveArm(arm, _shoulder, _handTarget, _pole);
            }

            // ripples and spray where the blade enters and leaves the water
            _blade.copy(_grip).addScaledVector(_dir, 1.2);
            canoe.localToWorld(_blade);
            const inWater = _blade.y < 0.02 && act > 0.4;
            if (inWater && !stroke.wasIn) {
                addRipple(_blade.x, _blade.z, 0.8);
                for (let i = 0; i < 4; i++) sprayAt(_blade, 0.6);
            } else if (!inWater && stroke.wasIn) {
                for (let i = 0; i < 7; i++) sprayAt(_blade, 1);
                addRipple(_blade.x, _blade.z, 0.5);
            }
            stroke.wasIn = inWater;
        }

        function sprayAt(p, k) {
            spray.spawn({
                x: p.x + (Math.random() - 0.5) * 0.2, y: Math.max(p.y, 0.02), z: p.z + (Math.random() - 0.5) * 0.2,
                vx: (Math.random() - 0.5) * 0.8 * k, vy: 0.8 + Math.random() * 1.2 * k, vz: (Math.random() - 0.5) * 0.8 * k,
                grav: 9.8, age: 0, life: 0.5 + Math.random() * 0.4, s0: 0.05, s1: 0.03, a: 0.9
            });
        }

        function scatterLeaves() {
            for (const lf of leaves) resetLeaf(lf, true);
        }
        function resetLeaf(lf, anywhere) {
            const ahead = boat.z - 10 - Math.random() * 90;
            if (anywhere && Math.random() < 0.45) {
                // already floating on the river
                const z = boat.z + 25 - Math.random() * 130;
                const p = riverPoint(z, (Math.random() * 2 - 1) * riverHalfWidth(z) * 0.85);
                lf.state = "water";
                lf.x = p.x;
                lf.z = p.z;
                lf.y = 0.015;
            } else {
                const z = anywhere ? boat.z + 30 - Math.random() * 110 : ahead;
                const p = riverPoint(z, (Math.random() * 2 - 1) * (riverHalfWidth(z) + 14));
                lf.state = "air";
                lf.x = p.x;
                lf.z = p.z;
                lf.y = 4 + Math.random() * 18;
            }
        }
        const _lm = new THREE.Matrix4();
        function updateLeaves(dt) {
            for (let i = 0; i < leaves.length; i++) {
                const lf = leaves[i];
                lf.phase += dt;
                if (lf.state === "air") {
                    lf.y -= lf.fall * dt;
                    lf.x += Math.sin(lf.phase * 1.3) * 0.7 * dt - 0.25 * dt;
                    lf.z += Math.cos(lf.phase * 0.9) * 0.5 * dt;
                    const ground = terrainHeight(lf.x, lf.z);
                    if (lf.y < Math.max(ground, 0) + 0.015) {
                        if (ground < 0) {
                            lf.state = "water";
                            lf.y = 0.015;
                        } else resetLeaf(lf, false);
                    }
                    _e.set(lf.phase * lf.spin, lf.rot, lf.phase * lf.spin * 0.7);
                } else {
                    const c = currentAt(lf.x, lf.z);
                    lf.x += c.x * dt;
                    lf.z += c.z * dt;
                    lf.y = 0.015 + Math.sin(lf.phase * 2 + lf.rot) * 0.01;
                    lf.rot += dt * 0.15;
                    _e.set(-Math.PI / 2, 0, lf.rot);
                }
                if (lf.z > boat.z + 45 || lf.z < boat.z - 130 || Math.abs(riverOffset(lf.x, lf.z)) > riverHalfWidth(lf.z) + 20) resetLeaf(lf, false);
                _lm.compose(_p.set(lf.x, lf.y, lf.z), _q.setFromEuler(_e), _s.set(1, 1, 1));
                leafMesh.setMatrixAt(i, _lm);
            }
            leafMesh.instanceMatrix.needsUpdate = true;
        }

        // ---------- per-frame update ----------

        const _sunRight = new THREE.Vector3(), _sunUp = new THREE.Vector3(), _center = new THREE.Vector3(), _v = new THREE.Vector3();
        _sunRight.crossVectors(sunDir, UP).normalize();
        _sunUp.crossVectors(_sunRight, sunDir).normalize();

        function update(dt) {
            time += dt;
            U.uTime.value = time;

            const thrIn = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0), steerIn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
            if (thrIn || steerIn) manualTimer = IDLE_DELAY;
            else manualTimer = Math.max(0, manualTimer - dt);
            // before Start the canoe paddles itself along; after that the current carries you until you paddle
            const input = started ? { thr: thrIn, steer: steerIn } : autopilotInput();
            thrS = damp(thrS, input.thr, 4, dt);
            steerS = damp(steerS, input.steer, 6, dt);
            pullS = damp(pullS, started && manualTimer <= 0 ? 1 : 0, 1.5, dt);
            // keep paddling and the strokes come twice as fast and hard
            holdTime = started && thrIn > 0 ? holdTime + dt : 0;
            const boosting = holdTime > BOOST_DELAY;
            boost = damp(boost, boosting ? 2 : 1, boosting ? 1.5 : 3, dt);

            // paddle side follows the steering: paddling on the right turns you left
            if (steerS > 0.35) stroke.side = 1;
            else if (steerS < -0.35) stroke.side = -1;
            stroke.sideS = damp(stroke.sideS, stroke.side, 4, dt);
            stroke.act = damp(stroke.act, Math.abs(thrS) > 0.08 ? 1 : 0, 2.2, dt);
            stroke.reverse = damp(stroke.reverse, thrS < -0.05 ? 1 : 0, 3, dt);
            if (stroke.act > 0.02) stroke.phase = (stroke.phase + (0.45 + 0.4 * Math.abs(thrS)) * boost * dt) % 1;
            const power = lerp(1, strokePower(), stroke.act);

            const steps = Math.ceil(dt / (1 / 60));
            for (let i = 0; i < steps; i++) stepBoat(dt / steps, thrS, input.steer, power, pullS);

            // a ride over the riffles, a lean into turns and strokes, and a jolt on a bump
            bump = Math.max(0, bump - dt * 2.5);
            const rough = riffle(boat.z);
            canoe.position.set(boat.x, 0.02 * Math.sin(time * 1.7) + rough * 0.03 * Math.sin(time * 6.3) + bump * 0.03 * Math.sin(time * 40), boat.z);
            canoe.rotation.y = boat.yaw;
            canoe.rotation.x = 0.01 * Math.sin(time * 1.3) + rough * 0.02 * Math.sin(time * 4.1);
            canoe.rotation.z = 0.012 * Math.sin(time * 1.1) - boat.w * 0.06 - stroke.sideS * 0.025 * stroke.act * (power - 0.35) + rough * 0.025 * Math.sin(time * 5.2);
            canoe.updateMatrixWorld();
            posePaddler();
            canoe.updateMatrixWorld();

            waterUniforms.uCanoe.value.set(boat.x, boat.z, Math.sin(boat.yaw), Math.cos(boat.yaw));
            waterUniforms.uCanoeSpeed.value = boat.speed;

            updateCamera(dt);

            // the shadow box follows the canoe, snapped to whole texels so edges don't crawl
            _center.set(boat.x - Math.sin(boat.yaw) * 14, 0, boat.z - Math.cos(boat.yaw) * 14);
            const texel = (shadowCam.right - shadowCam.left) / sun.shadow.mapSize.x;
            const a = _center.dot(_sunRight), b = _center.dot(_sunUp);
            _center.addScaledVector(_sunRight, Math.round(a / texel) * texel - a).addScaledVector(_sunUp, Math.round(b / texel) * texel - b);
            sun.target.position.copy(_center);
            sun.position.copy(_center).addScaledVector(sunDir, 260);
            sun.target.updateMatrixWorld();

            // site animations
            if (wheel) wheel.rotation.x -= dt * 0.55;
            for (const f of flames) {
                f.updateMatrixWorld();
                _v.setFromMatrixPosition(f.matrixWorld);
                if (Math.random() < dt * 30) {
                    flameGlow.spawn({
                        x: _v.x + (Math.random() - 0.5) * 0.3, y: _v.y + 0.05, z: _v.z + (Math.random() - 0.5) * 0.3,
                        vx: (Math.random() - 0.5) * 0.2, vy: 0.7 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.2,
                        grav: 0, age: 0, life: 0.35 + Math.random() * 0.3, s0: 0.5, s1: 0.12, a: 0.9
                    });
                }
            }
            for (const src of smokeSources) {
                src.acc = (src.acc || 0) + dt * src.rate;
                while (src.acc > 1) {
                    src.acc -= 1;
                    _v.copy(src.local);
                    src.group.localToWorld(_v);
                    smoke.spawn({
                        x: _v.x, y: _v.y, z: _v.z, vx: 0.25 + Math.random() * 0.2, vy: 0.6 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.2,
                        grav: -0.05, age: 0, life: 5 + Math.random() * 3, s0: src.size * 0.5, s1: src.size * 3.5, a: 0.2
                    });
                }
            }
            smoke.update(dt);
            spray.update(dt);
            flameGlow.update(dt);
            updateLeaves(dt);
            updateStops();

            if (boat.z < RIVER.end && !busy) {
                ui.toast("That's the end of the river. Back to the put-in!", 3500);
                jumpTo(-1);
            }
        }

        function updateCamera(dt) {
            cam.yaw += wrapAngle(boat.yaw - cam.yaw) * (1 - Math.exp(-2.2 * dt));
            if (time - cam.lastLook > 2.5) {
                cam.dragYaw = damp(cam.dragYaw, 0, 1.2, dt);
                cam.dragPitch = damp(cam.dragPitch, 0, 1.2, dt);
            }
            const sway = started || ui.reduceMotion ? 0 : 0.5 * Math.sin(time * 0.07);
            const yaw = cam.yaw + cam.dragYaw + sway, pitch = 0.3 + cam.dragPitch, dist = 7.6;
            const px = boat.x + Math.sin(yaw) * Math.cos(pitch) * dist, pz = boat.z + Math.cos(yaw) * Math.cos(pitch) * dist;
            const py = Math.max(0.9 + Math.sin(pitch) * dist, terrainHeight(px, pz) + 1.4, 0.7);
            camera.position.set(px, py, pz);
            camera.lookAt(boat.x - Math.sin(yaw) * 3, 1.0, boat.z - Math.cos(yaw) * 3);
        }

        function updateStops() {
            let nearest = -1, best = STOP_RANGE;
            const w = ui.stage.clientWidth, h = ui.stage.clientHeight;
            const byDistance = stopsInfo.map(function (info, i) {
                return { i: i, d: Math.hypot(boat.x - info.tip.x, boat.z - info.tip.z) };
            }).sort(function (a, b) { return a.d - b.d; });
            const placed = [];
            for (const s of byDistance) {
                if (s.d < best) {
                    best = s.d;
                    nearest = s.i;
                }
                // floating label over each landing; nearer labels win when two would overlap
                const label = ui.labels[s.i];
                _v.copy(stopsInfo[s.i].label).project(camera);
                const half = (label.width || 140) / 2 + 6; // keep it inside the frame
                const x = clamp((_v.x * 0.5 + 0.5) * w, half, w - half), y = Math.max((-_v.y * 0.5 + 0.5) * h, 48);
                const fade = smoothstep(190, 150, s.d) * smoothstep(8, 18, s.d);
                const blocked = placed.some(function (p) { return Math.abs(p[0] - x) < 150 && Math.abs(p[1] - y) < 34; });
                if (_v.z > 1 || fade <= 0.01 || blocked) {
                    if (label.shown !== "none") {
                        label.el.style.opacity = "0";
                        label.shown = "none";
                    }
                    continue;
                }
                placed.push([x, y]);
                label.el.style.opacity = fade.toFixed(2);
                label.el.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) translate(-50%,-100%)";
                const text = Math.round(s.d / 10) * 10 + " m";
                if (label.shown !== text) {
                    label.dist.textContent = text;
                    label.shown = text;
                    label.width = label.el.offsetWidth;
                }
            }
            if (nearest !== currentStop) {
                currentStop = nearest;
                ui.showStop(nearest);
            }
        }

        // ---------- rendering, sizing, frame loop ----------

        function render() {
            sky.position.copy(camera.position);
            for (const s of slices) s.mesh.visible = Math.abs(s.z - camera.position.z) < s.range;
            renderer.shadowMap.needsUpdate = true;
            if (useReflection) {
                renderReflection();
                for (const s of slices) if (s.noReflect) s.mesh.visible = Math.abs(s.z - camera.position.z) < s.range;
            }
            renderer.render(scene, camera);
        }

        function resize() {
            const w = Math.max(1, ui.stage.clientWidth), h = Math.max(1, ui.stage.clientHeight);
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.fov = w / h < 1 ? 64 : 50;
            camera.updateProjectionMatrix();
            reflTarget.setSize(Math.round(w * pixelRatio * 0.5), Math.round(h * pixelRatio * 0.5));
            const scale = h * pixelRatio / (2 * Math.tan(camera.fov * Math.PI / 360));
            for (const p of [smoke, spray, flameGlow]) p.material.uniforms.uScale.value = scale;
            if (!active) {
                updateCamera(0);
                render();
            }
        }

        // If the frame rate sags, give up the reflection pass, then some resolution
        let perfTime = 0, perfFrames = 0, perfLevel = 0, warmup = 2;
        function watchPerformance(dt) {
            if (warmup > 0) {
                warmup -= dt;
                return;
            }
            perfTime += dt;
            perfFrames++;
            if (perfTime < 3) return;
            const avg = perfTime / perfFrames;
            perfTime = perfFrames = 0;
            if (avg < 1 / 30 || perfLevel >= 3) return;
            perfLevel++;
            if (useReflection) {
                useReflection = false;
                waterUniforms.uHasRefl.value = 0;
            } else {
                pixelRatio = Math.max(0.75, pixelRatio - 0.25);
                renderer.setPixelRatio(pixelRatio);
                resize();
            }
        }

        function frame(now) {
            raf = requestAnimationFrame(frame);
            const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
            lastTime = now;
            update(dt);
            render();
            watchPerformance(dt);
        }

        function setActive(on) {
            // with reduced motion, nothing moves until the visitor starts paddling
            const run = on && (started || !ui.reduceMotion);
            if (run === active) return;
            active = run;
            if (run) {
                lastTime = performance.now();
                raf = requestAnimationFrame(frame);
            } else {
                cancelAnimationFrame(raf);
            }
        }

        function jumpTo(i) {
            if (busy) return;
            busy = true;
            ui.setFade(true);
            setTimeout(function () {
                placeBoat(i < 0 ? RIVER.start : STOPS[i].z + 40);
                ui.setFade(false);
                busy = false;
                if (!active) {
                    update(0);
                    render();
                }
            }, ui.reduceMotion ? 0 : 450);
        }

        // Back from a landing's page: the canoe sits just off the end of its dock and the current takes it on
        function pushOff(i) {
            const tip = stopsInfo[i].tip, side = STOPS[i].side;
            const s = riverSlope(tip.z), inv = 1 / Math.sqrt(1 + s * s);
            // 4 m downstream of the dock's end and 1 m in toward the bank
            placeBoat(tip.z - 4 * inv - side * s * inv, tip.x - 4 * s * inv + side * inv);
            currentStop = i; // you've just been there, so its card stays put away
            ui.showStop(-1);
            manualTimer = holdTime = 0;
            thrS = steerS = 0;
            boost = 1;
            stroke.act = 0;
        }

        placeBoat(RIVER.start);
        update(0);
        await breathe();
        await renderer.compileAsync(scene, camera); // compile shaders in the background where the browser supports it
        resize();

        return {
            get started() { return started; },
            start: function () {
                if (started) return;
                started = true;
                ui.stage.classList.add("is-playing");
                ui.toast(coarse ? "The current carries you. Hold Paddle to go faster, and the arrows to steer."
                    : "The current carries you. W or ↑ to paddle faster, A/D or ←/→ to steer.", 5000);
                setActive(onScreen && !document.hidden);
            },
            // back from a landing's page, by a fresh load or the browser restoring this one
            resume: function (i) {
                started = true;
                busy = false;
                ui.stage.classList.add("is-playing");
                pushOff(i);
                ui.setFade(false);
                const next = STOPS[i + 1];
                ui.toast("Back in the canoe. " + (next ? "Next stop: " + next.name + "." : "That was the last landing. Enjoy the float!"), 4500);
                setActive(onScreen && !document.hidden);
                if (!active) {
                    update(0);
                    render();
                }
            },
            setActive: setActive,
            resize: resize,
            jumpTo: jumpTo,
            setKey: function (key, down) { keys[key] = down; },
            releaseKeys: function () { for (const k in keys) keys[k] = false; },
            look: function (dx, dy) {
                cam.dragYaw -= dx * 0.006;
                cam.dragPitch = clamp(cam.dragPitch + dy * 0.004, -0.22, 0.75);
                cam.lastLook = time;
                if (!active) {
                    updateCamera(0);
                    render();
                }
            },
            goAshore: function () {
                if (currentStop < 0 || busy) return;
                busy = true;
                ui.setFade(true);
                ui.saveTrip(currentStop);
                const href = STOPS[currentStop].href;
                setTimeout(function () { window.location.href = href; }, ui.reduceMotion ? 0 : 400);
            },
            // back on this page by the browser's back button from somewhere other than a landing
            returned: function () {
                busy = false;
                ui.setFade(false);
            }
        };
    }
})();
