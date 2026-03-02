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

  function normalizedText(value) {
    return (value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function readRouteFromUrl() {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);

    const year = params.get("year");
    const album = params.get("album");
    const photoRaw = params.get("photo");

    let photo = null;
    if (photoRaw) {
      const parsed = Number.parseInt(photoRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        photo = parsed;
      }
    }

    return { year, album, photo };
  }

  function writeRouteToUrl(route, options) {
    const replace = Boolean(options && options.replace);
    const params = new URLSearchParams();

    if (route && route.year) params.set("year", route.year);
    if (route && route.album) params.set("album", route.album);
    if (route && Number.isFinite(route.photo) && route.photo > 0) {
      params.set("photo", String(route.photo));
    }

    const nextHash = params.toString() ? `#${params.toString()}` : "";
    if (nextHash === window.location.hash) return;

    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
    if (replace) {
      window.history.replaceState({}, "", nextUrl);
    } else {
      window.history.pushState({}, "", nextUrl);
    }
  }

  function createLightbox(root, hooks) {
    const overlay = el("div", "vs-lightbox is-hidden");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Photo viewer");

    const panel = el("div", "vs-lightbox-panel");
    const closeButton = el("button", "vs-lightbox-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close viewer");

    const mediaWrap = el("div", "vs-lightbox-media");
    const prevButton = el("button", "vs-lightbox-nav", "←");
    prevButton.type = "button";
    prevButton.setAttribute("aria-label", "Previous photo");
    const nextButton = el("button", "vs-lightbox-nav", "→");
    nextButton.type = "button";
    nextButton.setAttribute("aria-label", "Next photo");
    const navRow = el("div", "vs-lightbox-nav-row");

    const image = el("img", "vs-lightbox-image");
    image.alt = "";

    const meta = el("div", "vs-lightbox-meta");
    const title = el("div", "vs-lightbox-title");
    const counter = el("div", "vs-lightbox-counter");

    mediaWrap.appendChild(image);
    navRow.appendChild(prevButton);
    navRow.appendChild(nextButton);
    meta.appendChild(title);
    meta.appendChild(counter);

    panel.appendChild(closeButton);
    panel.appendChild(mediaWrap);
    panel.appendChild(navRow);
    panel.appendChild(meta);
    overlay.appendChild(panel);
    root.appendChild(overlay);

    let currentAlbum = null;
    let index = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouchTracking = false;

    function notifyIndex() {
      if (!currentAlbum) return;
      if (hooks && typeof hooks.onIndexChange === "function") {
        hooks.onIndexChange(currentAlbum, index);
      }
    }

    function render() {
      if (!currentAlbum || !currentAlbum.images.length) return;
      const active = currentAlbum.images[index];
      image.src = active.url;
      image.alt = `${currentAlbum.name} - ${active.name}`;
      title.textContent = `${currentAlbum.year} / ${currentAlbum.name}`;
      counter.textContent = `${index + 1} of ${currentAlbum.images.length}`;
      notifyIndex();
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
      const closingAlbum = currentAlbum;
      overlay.classList.add("is-hidden");
      document.body.classList.remove("vs-no-scroll");
      image.src = "";
      if (hooks && typeof hooks.onClose === "function") {
        hooks.onClose(closingAlbum);
      }
      currentAlbum = null;
    }

    function move(step) {
      if (!currentAlbum || !currentAlbum.images.length) return;
      index = (index + step + currentAlbum.images.length) % currentAlbum.images.length;
      render();
    }

    function onTouchStart(event) {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      isTouchTracking = true;
    }

    function onTouchEnd(event) {
      if (!isTouchTracking) return;
      isTouchTracking = false;
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;

      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
      if (!isHorizontal || Math.abs(deltaX) < 36) return;

      if (deltaX > 0) {
        move(-1);
      } else {
        move(1);
      }
    }

    closeButton.addEventListener("click", close);
    prevButton.addEventListener("click", () => move(-1));
    nextButton.addEventListener("click", () => move(1));
    mediaWrap.addEventListener("touchstart", onTouchStart, { passive: true });
    mediaWrap.addEventListener("touchend", onTouchEnd, { passive: true });
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

    const headerRow = el("div", "vs-year-header");
    const title = el("h2", "vs-year-title", yearData.year);
    const meta = el("div", "vs-year-meta", `${yearData.albums.length} albums`);
    headerRow.appendChild(title);
    headerRow.appendChild(meta);
    section.appendChild(headerRow);

    const rail = el("div", "vs-rail");
    const track = el("div", "vs-rail-track");

    const left = el("button", "vs-rail-button", "←");
    left.type = "button";
    left.setAttribute("aria-label", `Scroll ${yearData.year} albums left`);

    const right = el("button", "vs-rail-button", "→");
    right.type = "button";
    right.setAttribute("aria-label", `Scroll ${yearData.year} albums right`);

    const controls = el("div", "vs-rail-controls");
    controls.appendChild(left);
    controls.appendChild(right);

    for (const album of yearData.albums) {
      const card = el("button", "vs-rail-item");
      card.type = "button";
      card.setAttribute("aria-label", `Open album ${album.name}`);

      const thumbWrap = el("div", "vs-rail-thumb-wrap");
      const thumb = el("img", "vs-rail-thumb");
      thumb.src = album.coverUrl;
      thumb.alt = album.name;
      thumb.loading = "lazy";

      const badge = el("span", "vs-rail-badge", `${album.images.length} photos`);
      thumbWrap.appendChild(thumb);
      thumbWrap.appendChild(badge);

      const label = el("div", "vs-rail-label", album.name);

      card.appendChild(thumbWrap);
      card.appendChild(label);
      track.appendChild(card);

      card.addEventListener("click", () => {
        openAlbum(yearData.year, album.name, { pushUrl: true, scroll: true });
      });

      thumb.addEventListener("load", () => {
        window.requestAnimationFrame(updateRailControls);
      });
    }

    left.addEventListener("click", () => {
      track.scrollBy({ left: -460, behavior: "smooth" });
    });

    right.addEventListener("click", () => {
      track.scrollBy({ left: 460, behavior: "smooth" });
    });

    function updateRailControls() {
      const canScroll = track.scrollWidth - track.clientWidth > 4;
      rail.classList.toggle("is-static", !canScroll);
      left.disabled = !canScroll;
      right.disabled = !canScroll;
    }

    const onResize = () => updateRailControls();
    window.addEventListener("resize", onResize, { passive: true });

    rail.appendChild(track);
    rail.appendChild(controls);
    section.appendChild(rail);

    window.requestAnimationFrame(updateRailControls);

    return {
      section,
      cleanup() {
        window.removeEventListener("resize", onResize);
      },
    };
  }

  function createAlbumView(yearData, albumIndex, controls, lightbox) {
    const album = yearData.albums[albumIndex];

    const view = el("section", "vs-album-view");

    const topBar = el("div", "vs-album-top");
    const backButton = el("button", "vs-pill-button vs-back-button", "← Back to all albums");
    backButton.type = "button";
    backButton.addEventListener("click", () => {
      controls.backToYears({ pushUrl: true, scroll: true });
    });
    topBar.appendChild(backButton);

    const headingWrap = el("div", "vs-album-heading");
    const sub = el("div", "vs-album-subtitle", `${yearData.year}`);
    const heading = el("h2", "vs-album-title", album.name);
    const count = el("div", "vs-album-count", `${album.images.length} photos`);
    headingWrap.appendChild(sub);
    headingWrap.appendChild(heading);
    headingWrap.appendChild(count);

    view.appendChild(topBar);
    view.appendChild(headingWrap);

    const grid = el("div", "vs-photo-grid");

    for (let imageIndex = 0; imageIndex < album.images.length; imageIndex += 1) {
      const imageData = album.images[imageIndex];
      const imageButton = el("button", "vs-photo-item");
      imageButton.type = "button";
      imageButton.setAttribute("aria-label", `View photo ${imageIndex + 1} in ${album.name}`);

      const image = el("img", "vs-photo-thumb");
      image.src = imageData.url;
      image.alt = imageData.name || album.name;
      image.loading = "lazy";

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
        controls.openAlbum(yearData.year, yearData.albums[albumIndex - 1].name, {
          pushUrl: true,
          scroll: true,
        });
      });
    } else {
      prevButton.classList.add("is-hidden");
    }

    if (hasNext) {
      nextButton.addEventListener("click", () => {
        controls.openAlbum(yearData.year, yearData.albums[albumIndex + 1].name, {
          pushUrl: true,
          scroll: true,
        });
      });
    } else {
      nextButton.classList.add("is-hidden");
    }

    navRow.appendChild(prevButton);
    navRow.appendChild(nextButton);
    view.appendChild(navRow);

    return view;
  }

  function buildSearchIndex(years) {
    const out = [];
    years.forEach((yearData, yearIndex) => {
      yearData.albums.forEach((album, albumIndex) => {
        const hay = normalizedText(`${yearData.year} ${album.name}`);
        out.push({
          year: yearData.year,
          yearIndex,
          album,
          albumIndex,
          hay,
        });
      });
    });
    return out;
  }

  function runSearch(index, query) {
    const q = normalizedText(query);
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    return index.filter((item) => tokens.every((t) => item.hay.includes(t)));
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
    const header = el("section", "vs-topbar");
    const heroTitle = el("h1", "vs-topbar-title", "VSNY Photo Gallery");

    const searchWrap = el("div", "vs-search-wrap");
    const searchInput = el("input", "vs-search-input");
    searchInput.type = "search";
    searchInput.placeholder = "Search albums or years...";
    searchInput.setAttribute("aria-label", "Search albums");

    const searchResults = el("div", "vs-search-results");
    searchResults.hidden = true;

    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(searchResults);

    const stats = el("div", "vs-topbar-stats");
    const totalAlbums = years.reduce((sum, y) => sum + y.albums.length, 0);
    const totalImages = years.reduce(
      (sum, y) => sum + y.albums.reduce((inner, a) => inner + a.images.length, 0),
      0,
    );
    stats.textContent = `${years.length} sections • ${totalAlbums} albums • ${totalImages} photos`;

    header.appendChild(heroTitle);
    header.appendChild(stats);
    header.appendChild(searchWrap);

    const content = el("div", "vs-content");

    const overlayHost = el("div", "vs-overlay-host");
    let viewState = { view: "years", yearIndex: -1, albumIndex: -1 };
    let cleanupFns = [];
    const searchIndex = buildSearchIndex(years);

    const lightbox = createLightbox(overlayHost, {
      onIndexChange(album, index) {
        if (!album) return;
        writeRouteToUrl(
          {
            year: album.year,
            album: album.name,
            photo: index + 1,
          },
          { replace: true },
        );
      },
      onClose(album) {
        if (!album) return;
        writeRouteToUrl(
          {
            year: album.year,
            album: album.name,
          },
          { replace: true },
        );
      },
    });

    container.appendChild(shell);
    shell.appendChild(header);
    shell.appendChild(content);
    container.appendChild(overlayHost);

    function clearView() {
      for (const cleanup of cleanupFns) cleanup();
      cleanupFns = [];
      content.innerHTML = "";
    }

    function render() {
      clearView();
      const showSearch = viewState.view === "years";
      searchWrap.hidden = !showSearch;
      if (!showSearch) hideSearchResults();

      if (viewState.view === "album") {
        const yearData = years[viewState.yearIndex];
        const albumData = yearData && yearData.albums[viewState.albumIndex];

        if (yearData && albumData) {
          content.appendChild(
            createAlbumView(
              yearData,
              viewState.albumIndex,
              {
                backToYears: showYears,
                openAlbum,
              },
              lightbox,
            ),
          );
          return;
        }

        viewState = { view: "years", yearIndex: -1, albumIndex: -1 };
      }

      const yearsView = el("div", "vs-years-view");

      for (const yearData of years) {
        const { section, cleanup } = createYearSection(yearData, openAlbum);
        yearsView.appendChild(section);
        cleanupFns.push(cleanup);
      }

      content.appendChild(yearsView);
    }

    function hideSearchResults() {
      searchResults.hidden = true;
      searchResults.innerHTML = "";
    }

    function renderSearchResults(results) {
      searchResults.innerHTML = "";

      if (!results.length) {
        const empty = el("div", "vs-search-empty", "No matching albums");
        searchResults.appendChild(empty);
        searchResults.hidden = false;
        return;
      }

      const list = el("div", "vs-search-list");
      const limited = results.slice(0, 12);

      for (const item of limited) {
        const row = el("button", "vs-search-result");
        row.type = "button";
        row.setAttribute("aria-label", `Open album ${item.album.name}`);

        const name = el("div", "vs-search-result-name", item.album.name);
        const meta = el("div", "vs-search-result-meta", `${item.year} • ${item.album.images.length} photos`);

        row.appendChild(name);
        row.appendChild(meta);
        list.appendChild(row);

        row.addEventListener("click", () => {
          hideSearchResults();
          openAlbum(item.year, item.album.name, { pushUrl: true, scroll: true });
        });
      }

      searchResults.appendChild(list);
      searchResults.hidden = false;
    }

    function openAlbum(year, albumName, options) {
      const yearIndex = years.findIndex((entry) => entry.year === year);
      if (yearIndex === -1) return;

      const albumIndex = years[yearIndex].albums.findIndex((entry) => entry.name === albumName);
      if (albumIndex === -1) return;

      viewState = { view: "album", yearIndex, albumIndex };
      render();
      hideSearchResults();

      const pushUrl = Boolean(options && options.pushUrl);
      const replaceUrl = Boolean(options && options.replaceUrl);
      if (pushUrl || replaceUrl) {
        writeRouteToUrl(
          {
            year,
            album: albumName,
          },
          { replace: replaceUrl },
        );
      }

      if (!options || options.scroll !== false) {
        container.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      if (options && Number.isFinite(options.photoIndex) && options.photoIndex >= 0) {
        const albumData = years[yearIndex].albums[albumIndex];
        const maxIndex = Math.max(0, albumData.images.length - 1);
        const imageIndex = Math.min(options.photoIndex, maxIndex);
        lightbox.open({ ...albumData, year }, imageIndex);
      }
    }

    function showYears(options) {
      viewState = { view: "years", yearIndex: -1, albumIndex: -1 };
      render();

      const pushUrl = Boolean(options && options.pushUrl);
      const replaceUrl = Boolean(options && options.replaceUrl);
      if (pushUrl || replaceUrl) {
        writeRouteToUrl({}, { replace: replaceUrl });
      }

      if (!options || options.scroll !== false) {
        container.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function applyRouteFromUrl() {
      const route = readRouteFromUrl();

      if (route.year && route.album) {
        const zeroBasedPhoto = Number.isFinite(route.photo) ? route.photo - 1 : undefined;
        openAlbum(route.year, route.album, {
          replaceUrl: true,
          scroll: false,
          photoIndex: zeroBasedPhoto,
        });
        return;
      }

      showYears({ replaceUrl: true, scroll: false });
    }

    searchInput.addEventListener("input", () => {
      const trimmed = (searchInput.value || "").trim();
      if (!trimmed) {
        hideSearchResults();
        return;
      }
      const results = runSearch(searchIndex, trimmed);
      renderSearchResults(results);
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const trimmed = searchInput.value.trim();
      if (!trimmed) return;
      const results = runSearch(searchIndex, trimmed);
      if (results.length) {
        event.preventDefault();
        hideSearchResults();
        openAlbum(results[0].year, results[0].album.name, { pushUrl: true, scroll: true });
      }
    });

    document.addEventListener("click", (event) => {
      if (!searchWrap.contains(event.target)) {
        hideSearchResults();
      }
    });

    window.addEventListener("popstate", applyRouteFromUrl);
    window.addEventListener("hashchange", applyRouteFromUrl);

    applyRouteFromUrl();
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
