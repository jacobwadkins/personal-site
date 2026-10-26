// On the pages you reach by going ashore from the canoe on the Personal page: a button to hop back in.
// canoe-river.js leaves a note in sessionStorage naming the landing, and picks the trip back up from it.
(function () {
    "use strict";

    let trip = null;
    try {
        trip = JSON.parse(sessionStorage.getItem("canoeRiver"));
    } catch (e) {
        return;
    }
    if (!trip || !(Date.now() - trip.time < 60 * 60 * 1000)) return;

    const link = document.createElement("a");
    link.className = "cr-return";
    link.href = "Personal.html";
    link.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M2 14h20c-2 3.5-6 5-10 5s-8-1.5-10-5z" fill="currentColor"/><path d="M17 3l-5 15"/></svg>' +
        "Hop back in the canoe";

    // Straight back when we came from the river, so the browser can restore it just as it was left
    link.addEventListener("click", function (e) {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        let from = null;
        try {
            from = new URL(document.referrer);
        } catch (err) { /* no referrer */ }
        if (from && from.origin === location.origin && /\/Personal(\.html)?$/i.test(from.pathname) && history.length > 1) {
            e.preventDefault();
            history.back();
        }
    });

    document.body.appendChild(link);
})();
