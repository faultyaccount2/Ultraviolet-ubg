import httpProxy from "http-proxy";

const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    secure: true,
    followRedirects: true
});

export default function handler(req, res) {
    const raw = req.query.url;

    if (!raw) {
        res.statusCode = 400;
        return res.end("Missing url");
    }

    let target;

    try {
        target = new URL(raw);
    } catch {
        res.statusCode = 400;
        return res.end("Invalid URL");
    }

    if (!["http:", "https:"].includes(target.protocol)) {
        res.statusCode = 400;
        return res.end("Unsupported protocol");
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
                res.statusCode = 502;
                res.end("Proxy error");
            }
        }
    );
}
