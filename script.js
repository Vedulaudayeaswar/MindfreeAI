const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector("#site-nav");
const header = document.querySelector(".site-header");
const hero = document.querySelector(".hero");

menuButton?.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

nav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("open");
    menuButton?.setAttribute("aria-expanded", "false");
  });
});

if (header && hero) {
  const updateHeader = () => {
    header.classList.toggle("scrolled", window.scrollY > hero.offsetHeight - 120);
  };
  window.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();
}
