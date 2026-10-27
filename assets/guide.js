const year = document.querySelector("#year");
const currentYear = new Date().getFullYear();

if (year) year.textContent = String(currentYear);

if (window.lucide?.createIcons) {
  window.lucide.createIcons({
    attrs: {
      "aria-hidden": "true",
      "stroke-width": 1.8,
    },
  });
}
