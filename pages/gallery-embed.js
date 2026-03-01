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

  function findAlbumAnchor(yearSection, albumName) {
    return yearSection.querySelector(`[data-album-name="${CSS.escape(albumName)}"]`);
  }

  function createLightbox(root) {
    const overlay = el("div", "vs-lightbox is-hidden");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Album viewer");

    const panel = el("div", "vs-lightbox-panel");
    const closeButton = el("button", "vs-lightbox-close", "Close");
    closeButton.type = "button";

    const mediaWrap = el("div", "vs-lightbox-media");
    const prevButton = el("button", "vs-lightbox-nav prev", "Prev");
    prevButton.type = "button";
    const nextButton = el("button", "vs-lightbox-nav next", "Next");
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

    function open(album) {
      currentAlbum = album;
      index = 0;
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

  function createYearSection(yearData, lightbox) {
    const section = el("section", "vs-year");
    section.id = `vs-year-${yearData.year}`;

    const header = el("h2", "vs-year-title", yearData.year);
    section.appendChild(header);

    const rail = el("div", "vs-rail");
    const left = el("button", "vs-rail-button", "◀");
    left.type = "button";
    left.setAttribute("aria-label", `Scroll ${yearData.year} albums left`);
    const right = el("button", "vs-rail-button", "▶");
    right.type = "button";
    right.setAttribute("aria-label", `Scroll ${yearData.year} albums right`);

    const track = el("div", "vs-rail-track");

    for (const album of yearData.albums) {
      const button = el("button", "vs-rail-item");
      button.type = "button";
      button.dataset.albumName = album.name;

      const thumb = el("img", "vs-rail-thumb");
      thumb.src = album.coverUrl;
      thumb.alt = album.name;

      const label = el("div", "vs-rail-label", album.name);

      button.appendChild(thumb);
      button.appendChild(label);
      track.appendChild(button);

      button.addEventListener("click", () => {
        const anchor = findAlbumAnchor(section, album.name);
        if (anchor) {
          anchor.scrollIntoView({ behavior: "smooth", block: "center" });
          anchor.focus({ preventScroll: true });
        }
      });

      thumb.addEventListener("load", () => {
        window.requestAnimationFrame(updateRailControls);
      });
    }

    left.addEventListener("click", () => {
      track.scrollBy({ left: -360, behavior: "smooth" });
    });

    right.addEventListener("click", () => {
      track.scrollBy({ left: 360, behavior: "smooth" });
    });

    function updateRailControls() {
      const canScroll = track.scrollWidth - track.clientWidth > 4;
      rail.classList.toggle("is-static", !canScroll);
      left.disabled = !canScroll;
      right.disabled = !canScroll;
    }

    rail.appendChild(left);
    rail.appendChild(track);
    rail.appendChild(right);
    section.appendChild(rail);

    window.requestAnimationFrame(updateRailControls);
    window.addEventListener("resize", updateRailControls, { passive: true });

    const grid = el("div", "vs-album-grid");

    for (const album of yearData.albums) {
      const card = el("button", "vs-album-card");
      card.type = "button";
      card.dataset.albumName = album.name;
      card.setAttribute("aria-label", `Open album ${album.name}`);

      const cover = el("img", "vs-album-cover");
      cover.src = album.coverUrl;
      cover.alt = album.name;

      const name = el("div", "vs-album-name", album.name);
      const count = el("div", "vs-album-count", `${album.images.length} photos`);

      card.appendChild(cover);
      card.appendChild(name);
      card.appendChild(count);
      grid.appendChild(card);

      card.addEventListener("click", () => {
        lightbox.open({ ...album, year: yearData.year });
      });
    }

    section.appendChild(grid);
    return section;
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
    const lightbox = createLightbox(shell);

    for (const year of years) {
      shell.appendChild(createYearSection(year, lightbox));
    }

    container.appendChild(shell);
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
