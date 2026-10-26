// The Menu button in the header, which stands in for the page links on phones (styles.css shows one or the other)
(function () {
    "use strict";

    const nav = document.querySelector(".site-nav");
    const button = nav && nav.querySelector(".site-menu-button");
    if (!button) return;

    function setOpen(open) {
        nav.classList.toggle("is-open", open);
        button.setAttribute("aria-expanded", String(open));
    }

    // Without this script the links stay in the header, wrapping under the name where they don't fit
    nav.classList.add("has-menu");

    button.addEventListener("click", function () {
        setOpen(!nav.classList.contains("is-open"));
    });

    document.addEventListener("click", function (e) {
        if (!nav.contains(e.target)) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && nav.classList.contains("is-open")) {
            setOpen(false);
            button.focus();
        }
    });
})();
