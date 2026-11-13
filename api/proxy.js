import httpProxy from "http-proxy";

const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    secure: true,
    followRedirects: true
});

export default function handler(req, res) {
    const raw = req.query.url;

    if (!raw) {
        return res.status(400).send("Missing url");
    }

    let target;

    try {
        target = new URL(raw);
    } catch {
        return res.status(400).send("Invalid URL");
    }

    if (!["http:", "https:"].includes(target.protocol)) {
        return res.status(400).send("Unsupported protocol");
    }

    proxy.web(
        req,
        res,
        {
            target: target.href,
            changeOrigin: true
        },
        (error) => {
            console.error(error);

            if (!res.headersSent) {
                res.status(502).send("Proxy error");
            }
        }
    );
}
