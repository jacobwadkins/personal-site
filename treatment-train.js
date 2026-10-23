// Interactive treatment train diagram on the Professional page.
// Project notes are drawn from Portfolio.html; keep them in sync if that page changes.
(function () {
    const STAGES = [
        {
            name: "Equalization",
            sub: "Pump station and equalization tank",
            what: "Industrial plants don't produce wastewater at a steady rate. A wash-down shift can send a surge of high-strength water all at once. Equalization tanks absorb those peaks and blend the flow so everything downstream sees a steady, predictable load, and a pump station lifts it into the rest of the system.",
            projects: [
                { name: "Bottling Facility WWTS", loc: "New Jersey", note: "Equalization tank, pump station, and flow metering integrated with treatment equipment the client had already purchased." },
                { name: "Yogurt Production WWTS Upgrades", loc: "Idaho", note: "New calamity tank and diversion system to absorb shock-load events, with jet mixing for the calamity and EQ tanks." },
                { name: "Beef Patty and Sauce Production WWTS", loc: "California", note: "Influent pump station feeding the treatment system." }
            ]
        },
        {
            name: "Screening",
            sub: "Rotary drum screen",
            what: "A slowly rotating drum covered in fine mesh catches debris like food scraps, packaging, and fibers before it can clog pumps or settle in tanks. The screenings are washed off the drum and hauled away.",
            projects: [
                { name: "Beef Patty and Sauce Production WWTS", loc: "California", note: "Rotary drum screen to remove debris ahead of flotation." }
            ]
        },
        {
            name: "Flotation",
            sub: "Dissolved or suspended air flotation (DAF / SAF)",
            what: "Tiny air bubbles attach to fats, oils, grease (FOG) and suspended solids and carry them to the surface, where skimmers push the float layer off for disposal. Food and beverage wastewater is full of FOG, so this step does a lot of the heavy lifting.",
            projects: [
                { name: "Beef Patty and Sauce Production WWTS", loc: "California", note: "DAF to remove FOG and solids, followed by pH adjustment before discharge to the sanitary sewer." },
                { name: "Yogurt Production WWTS Upgrades", loc: "Idaho", note: "Converted existing DAF units to suspended air flotation (SAF) and added secondary SAF to improve solids removal." }
            ]
        },
        {
            name: "Biological treatment",
            sub: "Aeration basins",
            what: "This is where the real cleaning happens. Bacteria consume the dissolved organic pollutants that physical treatment can't catch. Blowers push air through diffusers on the basin floor to keep the microbes supplied with oxygen and the tank well mixed.",
            projects: [
                { name: "Yogurt Production WWTS Upgrades", loc: "Idaho", note: "Two new aeration basins that increased aeration capacity by 350%, allowing the problematic anaerobic reactor to be decommissioned." }
            ]
        },
        {
            name: "Membrane filtration",
            sub: "Membrane bioreactor (MBR)",
            what: "Bundles of hollow-fiber membranes, with pores far smaller than bacteria, draw clean water out of the biological tank and leave the solids behind. Air scours the fibers to keep them from fouling. What comes out is clear enough to feed advanced purification.",
            projects: [
                { name: "Yogurt Production WWTS Upgrades", loc: "Idaho", note: "MBR effluent is treated to potable water standards in the new purification building downstream." }
            ]
        },
        {
            name: "Advanced purification",
            sub: "Reverse osmosis, UV/AOP, carbon, disinfection",
            what: "Reverse osmosis forces water through membranes that reject dissolved salts. UV light combined with an oxidant (an advanced oxidation process) breaks down trace organics and inactivates pathogens. Carbon filtration and disinfection provide the final polish.",
            projects: [
                { name: "Yogurt Production WWTS Upgrades", loc: "Idaho", note: "New 12,000 sf water purification building housing RO units, UV/AOP, carbon filtration, and disinfection equipment." }
            ]
        },
        {
            name: "Reuse",
            sub: "Reuse water storage",
            what: "Instead of being discharged, the purified water is stored and sent back into the plant. Cooling tower makeup is a common first use, and with regulatory approval it can cover indirect uses like cleaning. Every gallon reused is a gallon the plant doesn't have to draw from the local supply.",
            projects: [
                { name: "Yogurt Production WWTS Upgrades", loc: "Idaho", note: "Three new 125,000-gallon reuse water storage tanks supplying cooling tower makeup, with in-plant uses such as cleaning upon state approval." }
            ]
        }
    ];
    const TOUR_MS = 5000; // keep in sync with the tt-progress animation in styles.css

    const root = document.getElementById("treatment-train");
    if (!root) return;
    const units = [...root.querySelectorAll(".tt-unit")];
    const scroller = root.querySelector(".tt-scroll");
    const tablist = root.querySelector(".tt-tabs");
    const panel = root.querySelector("#tt-panel");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Bubbles: random sizes, positions, and timing so they don't rise in lockstep
    root.querySelectorAll(".tt-bubbles").forEach(function (group) {
        const [x0, x1] = group.dataset.x.split(" ").map(Number);
        const [y0, y1] = group.dataset.y.split(" ").map(Number);
        const [r0, r1] = group.dataset.r.split(" ").map(Number);
        for (let i = 0; i < Number(group.dataset.n); i++) {
            const bubble = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            const duration = 2 + Math.random() * 2;
            bubble.setAttribute("class", "tt-bubble");
            bubble.setAttribute("cx", (x0 + Math.random() * (x1 - x0)).toFixed(1));
            // Without animation, scatter them through the tank instead of piling up at the bottom
            bubble.setAttribute("cy", reduceMotion ? (y1 + Math.random() * (y0 - y1)).toFixed(1) : y0);
            bubble.setAttribute("r", (r0 + Math.random() * (r1 - r0)).toFixed(1));
            bubble.style.setProperty("--rise", (y0 - y1) + "px");
            bubble.style.animationDuration = duration + "s";
            bubble.style.animationDelay = (-Math.random() * duration) + "s";
            group.appendChild(bubble);
        }
    });

    const tabs = STAGES.map(function (stage, i) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.id = "tt-tab-" + i;
        tab.className = "tt-tab";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", "tt-panel");
        tab.innerHTML = '<span class="tt-tab-num">' + (i + 1) + "</span>" + stage.name;
        tab.addEventListener("click", function () { stopTour(); select(i); });
        tablist.appendChild(tab);
        return tab;
    });

    tablist.addEventListener("keydown", function (e) {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        stopTour();
        select((current + step + STAGES.length) % STAGES.length);
        tabs[current].focus();
    });

    units.forEach(function (unit, i) {
        unit.addEventListener("click", function () { stopTour(); select(i); });
    });

    let current = 0;

    function select(i) {
        current = i;
        units.forEach(function (unit, j) { unit.classList.toggle("is-active", j === i); });
        tabs.forEach(function (tab, j) {
            tab.setAttribute("aria-selected", j === i ? "true" : "false");
            tab.tabIndex = j === i ? 0 : -1;
        });
        panel.setAttribute("aria-labelledby", tabs[i].id);

        const stage = STAGES[i];
        panel.innerHTML =
            "<div>" +
                '<p class="tt-kicker">Stage ' + (i + 1) + " of " + STAGES.length + "</p>" +
                '<h3 class="text-2xl font-bold text-gray-800">' + stage.name + "</h3>" +
                '<p class="text-gray-500 mb-3">' + stage.sub + "</p>" +
                '<p class="text-gray-700 leading-relaxed">' + stage.what + "</p>" +
            "</div>" +
            "<div>" +
                '<p class="tt-kicker mb-2">Where I\'ve designed it</p>' +
                '<ul class="space-y-3">' + stage.projects.map(function (p) {
                    return '<li class="tt-project">' +
                        '<p class="font-bold text-gray-800">' + p.name + ' <span class="font-normal text-gray-500">· ' + p.loc + "</span></p>" +
                        '<p class="text-sm text-gray-700">' + p.note + "</p>" +
                    "</li>";
                }).join("") + "</ul>" +
                '<a href="Portfolio.html" class="inline-block mt-3 text-blue-700 font-semibold hover:text-red-500 transition duration-300">See the full projects &rarr;</a>' +
            "</div>";
        panel.classList.remove("tt-fade");
        void panel.offsetWidth; // restart the fade-in animation
        panel.classList.add("tt-fade");

        // Keep the active stage visible when the diagram or tab row is scrolled sideways (phones).
        // Only scroll these containers, never the page itself.
        centerIn(scroller, units[i].getBoundingClientRect());
        centerIn(tablist, tabs[i].getBoundingClientRect());
    }

    function centerIn(container, rect) {
        if (container.scrollWidth <= container.clientWidth) return;
        const box = container.getBoundingClientRect();
        const offset = rect.left + rect.width / 2 - (box.left + box.width / 2);
        container.scrollBy({ left: offset, behavior: reduceMotion ? "auto" : "smooth" });
    }

    // Auto-tour: step through the stages while the diagram is on screen, until the visitor takes over
    let touring = !reduceMotion;
    let timer = null;

    function startTour() {
        if (!touring || timer) return;
        root.classList.add("tt-touring");
        select(current); // restart the progress bar on the current tab
        timer = setInterval(function () { select((current + 1) % STAGES.length); }, TOUR_MS);
    }

    function pauseTour() {
        clearInterval(timer);
        timer = null;
        root.classList.remove("tt-touring");
    }

    function stopTour() {
        touring = false;
        pauseTour();
    }

    scroller.addEventListener("pointerdown", stopTour);
    scroller.addEventListener("wheel", function (e) {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) stopTour(); // sideways scrolling only, not page scrolling
    }, { passive: true });

    select(0);
    if (touring && "IntersectionObserver" in window) {
        new IntersectionObserver(function (entries) {
            entries[0].isIntersecting ? startTour() : pauseTour();
        }, { threshold: 0.5 }).observe(root.querySelector(".tt-diagram"));
    }
})();
