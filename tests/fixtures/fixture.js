document.getElementById("add").addEventListener("click", () => {
  const image = document.createElement("img");
  image.width = 600; image.height = 400; image.loading = "lazy"; image.alt = "Dynamically inserted image"; image.src = "image.svg?dynamic=" + Date.now();
  document.getElementById("dynamic").append(image);
});
