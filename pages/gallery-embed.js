(function () {
  const DEFAULT_INDEX_PATH = "/index.json";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function normalizeIndexUrl(raw) {
    if (!raw) return DEFAULT_INDEX_PATH;
    return raw.trim();
  }

  function createLightbox(root) {
    const overlay = el("div", "vs-lightbox is-hidden");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Photo viewer");

    const panel = el("div", "vs-lightbox-panel");
    const closeButton = el("button", "vs-lightbox-close", "Close");
    closeButton.type = "button";

    const mediaWrap = el("div", "vs-lightbox-media");
    const prevButton = el("button", "vs-lightbox-nav", "Prev");
    prevButton.type = "button";
    const nextButton = el("button", "vs-lightbox-nav", "Next");
    nextButton.type = "button";

    const image = el("img", "vs-lightbox-image");
    image.alt = "";

    const meta = el("div", "vs-lightbox-meta");
    const title = el("div", "vs-lightbox-title");
    const counter = el("div", "vs-lightbox-counter");

    mediaWrap.appendChild(prevButton);
    mediaWrap.appendChild(image);
    mediaWrap.appendChild(nextButton);
    meta.appendChild(title);
    meta.appendChild(counter);

    panel.appendChild(closeButton);
    panel.appendChild(mediaWrap);
    panel.appendChild(meta);
    overlay.appendChild(panel);
    root.appendChild(overlay);

    let currentAlbum = null;
    let index = 0;

    function render() {
      if (!currentAlbum || !currentAlbum.images.length) return;
      const active = currentAlbum.images[index];
      image.src = active.url;
      image.alt = `${currentAlbum.name} - ${active.name}`;
      title.textContent = `${currentAlbum.year} / ${currentAlbum.name}`;
      counter.textContent = `${index + 1} of ${currentAlbum.images.length}`;
    }

    function open(album, startIndex) {
      currentAlbum = album;
      if (!album.images.length) return;
      const safeIndex = Number.isInteger(startIndex) ? startIndex : 0;
      index = Math.max(0, Math.min(safeIndex, album.images.length - 1));
      render();
      overlay.classList.remove("is-hidden");
      document.body.classList.add("vs-no-scroll");
    }

    function close() {
      overlay.classList.add("is-hidden");
      document.body.classList.remove("vs-no-scroll");
      image.src = "";
    }

    function move(step) {
      if (!currentAlbum || !currentAlbum.images.length) return;
      index = (index + step + currentAlbum.images.length) % currentAlbum.images.length;
      render();
    }

    closeButton.addEventListener("click", close);
    prevButton.addEventListener("click", () => move(-1));
    nextButton.addEventListener("click", () => move(1));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });

    document.addEventListener("keydown", (event) => {
      if (overlay.classList.contains("is-hidden")) return;
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    });

    return { open };
  }

  function createYearSection(yearData, openAlbum) {
    const section = el("section", "vs-year");

    const header = el("h2", "vs-year-title", yearData.year);
    section.appendChild(header);

    const rail = el("div", "vs-rail");
    const left = el("button", "vs-rail-button", "←");
    left.type = "button";
    left.setAttribute("aria-label", `Scroll ${yearData.year} albums left`);

    const right = el("button", "vs-rail-button", "→");
    right.type = "button";
    right.setAttribute("aria-label", `Scroll ${yearData.year} albums right`);

    const track = el("div", "vs-rail-track");

    for (const album of yearData.albums) {
      const card = el("button", "vs-rail-item");
      card.type = "button";
      card.setAttribute("aria-label", `Open album ${album.name}`);

      const thumb = el("img", "vs-rail-thumb");
      thumb.src = album.coverUrl;
      thumb.alt = album.name;

      const label = el("div", "vs-rail-label", album.name);

      card.appendChild(thumb);
      card.appendChild(label);
      track.appendChild(card);

      card.addEventListener("click", () => {
        openAlbum(yearData.year, album.name);
      });

      thumb.addEventListener("load", () => {
        window.requestAnimationFrame(updateRailControls);
      });
    }

    left.addEventListener("click", () => {
      track.scrollBy({ left: -420, behavior: "smooth" });
    });

    right.addEventListener("click", () => {
      track.scrollBy({ left: 420, behavior: "smooth" });
    });

    function updateRailControls() {
      const canScroll = track.scrollWidth - track.clientWidth > 4;
      rail.classList.toggle("is-static", !canScroll);
      left.disabled = !canScroll;
      right.disabled = !canScroll;
    }

    const onResize = () => updateRailControls();
    window.addEventListener("resize", onResize, { passive: true });

    rail.appendChild(left);
    rail.appendChild(track);
    rail.appendChild(right);
    section.appendChild(rail);

    window.requestAnimationFrame(updateRailControls);

    return {
      section,
      cleanup() {
        window.removeEventListener("resize", onResize);
      },
    };
  }

  function createAlbumView(yearData, albumIndex, backToYears, openAlbum, lightbox) {
    const album = yearData.albums[albumIndex];

    const view = el("section", "vs-album-view");

    const backButton = el("button", "vs-pill-button vs-back-button", "← Back to years");
    backButton.type = "button";
    backButton.addEventListener("click", backToYears);
    view.appendChild(backButton);

    const heading = el("h2", "vs-album-title", `${yearData.year} — ${album.name}`);
    view.appendChild(heading);

    const grid = el("div", "vs-photo-grid");

    for (let imageIndex = 0; imageIndex < album.images.length; imageIndex += 1) {
      const imageData = album.images[imageIndex];
      const imageButton = el("button", "vs-photo-item");
      imageButton.type = "button";
      imageButton.setAttribute("aria-label", `View photo ${imageIndex + 1} in ${album.name}`);

      const image = el("img", "vs-photo-thumb");
      image.src = imageData.url;
      image.alt = imageData.name || album.name;

      imageButton.appendChild(image);
      grid.appendChild(imageButton);

      imageButton.addEventListener("click", () => {
        lightbox.open({ ...album, year: yearData.year }, imageIndex);
      });
    }

    view.appendChild(grid);

    const navRow = el("div", "vs-album-nav");
    const prevButton = el("button", "vs-pill-button", "← Previous album");
    const nextButton = el("button", "vs-pill-button", "Next album →");
    prevButton.type = "button";
    nextButton.type = "button";

    const hasPrev = albumIndex > 0;
    const hasNext = albumIndex < yearData.albums.length - 1;

    if (hasPrev) {
      prevButton.addEventListener("click", () => {
        openAlbum(yearData.year, yearData.albums[albumIndex - 1].name);
      });
    } else {
      prevButton.classList.add("is-hidden");
    }

    if (hasNext) {
      nextButton.addEventListener("click", () => {
        openAlbum(yearData.year, yearData.albums[albumIndex + 1].name);
      });
    } else {
      nextButton.classList.add("is-hidden");
    }

    navRow.appendChild(prevButton);
    navRow.appendChild(nextButton);
    view.appendChild(navRow);

    return view;
  }

  async function loadGallery(container) {
    const status = el("div", "vs-status", "Loading gallery...");
    container.appendChild(status);

    const indexUrl = normalizeIndexUrl(container.dataset.indexUrl || DEFAULT_INDEX_PATH);

    let payload;
    try {
      const response = await fetch(indexUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      payload = await response.json();
    } catch (error) {
      status.textContent = `Could not load gallery index (${error.message}).`;
      return;
    }

    const years = Array.isArray(payload.years) ? payload.years : [];
    container.innerHTML = "";

    if (!years.length) {
      container.appendChild(el("div", "vs-status", "No albums found yet."));
      return;
    }

    const shell = el("div", "vs-gallery-shell");
    const overlayHost = el("div", "vs-overlay-host");
    const lightbox = createLightbox(overlayHost);

    container.appendChild(shell);
    container.appendChild(overlayHost);

    let cleanupFns = [];
    let viewState = { view: "years", yearIndex: -1, albumIndex: -1 };

    function clearView() {
      for (const dispose of cleanupFns) dispose();
      cleanupFns = [];
      shell.innerHTML = "";
    }

    function openAlbum(year, albumName) {
      const yearIndex = years.findIndex((entry) => entry.year === year);
      if (yearIndex === -1) return;

      const albumIndex = years[yearIndex].albums.findIndex((entry) => entry.name === albumName);
      if (albumIndex === -1) return;

      viewState = { view: "album", yearIndex, albumIndex };
      render();
      container.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function showYears() {
      viewState = { view: "years", yearIndex: -1, albumIndex: -1 };
      render();
      container.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function render() {
      clearView();

      if (viewState.view === "album") {
        const yearData = years[viewState.yearIndex];
        const albumData = yearData && yearData.albums[viewState.albumIndex];

        if (yearData && albumData) {
          shell.appendChild(
            createAlbumView(yearData, viewState.albumIndex, showYears, openAlbum, lightbox),
          );
          return;
        }

        viewState = { view: "years", yearIndex: -1, albumIndex: -1 };
      }

      for (const year of years) {
        const { section, cleanup } = createYearSection(year, openAlbum);
        shell.appendChild(section);
        cleanupFns.push(cleanup);
      }
    }

    render();
  }

  function bootstrap() {
    const nodes = document.querySelectorAll("[data-vs-gallery]");
    for (const node of nodes) {
      loadGallery(node);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
