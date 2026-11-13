(() => {
    const form = document.getElementById("form");
    const input = form?.querySelector("input");
    const frames = document.getElementById("frames");

    if (!form || !input || !frames) return;

    function openProxy(value, save = true) {
        let url = value.trim();

        if (!url) return;

        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
            url = "https://" + url;
        }

        const frame = document.createElement("iframe");

        frame.className = "w-full h-full border-0 absolute";
        frame.title = "Proxy Frame";
        frame.src = "/api/proxy?url=" + encodeURIComponent(url);

        frames.replaceChildren(frame);

        if (save) {
            history.pushState(
                { url },
                "",
                location.pathname + "#" + encodeURIComponent(url)
            );
        }
    }

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        openProxy(input.value);
    });

    window.addEventListener("popstate", () => {
        const hash = location.hash.slice(1);

        if (!hash) return;

        try {
            const url = decodeURIComponent(hash);
            input.value = url;
            openProxy(url, false);
        } catch {}
    });
})();
