const MAX_REQUEST_BYTES = 1024 * 1024;

async function copyBody(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new TypeError("Proxied POST bodies are limited to 1 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function proxyRequest(input, options, resource, RequestConstructor) {
  if (!(input instanceof RequestConstructor)) {
    const init = {
      ...options,
      mode: "cors",
      credentials: "omit",
    };
    if (init.body instanceof ReadableStream) init.duplex = "half";
    return new RequestConstructor(resource(String(input)), init);
  }

  const source = input.clone();
  const init = {
    ...options,
    method: options?.method ?? input.method,
    headers: options?.headers ?? input.headers,
    mode: "cors",
    credentials: "omit",
    cache: options?.cache ?? input.cache,
    redirect: options?.redirect ?? input.redirect,
    referrer: options?.referrer ?? input.referrer,
    referrerPolicy: options?.referrerPolicy ?? input.referrerPolicy,
    integrity: options?.integrity ?? input.integrity,
    keepalive: options?.keepalive ?? input.keepalive,
    signal: options?.signal ?? input.signal,
  };
  if (options?.body !== undefined) {
    if (options.body instanceof ReadableStream) init.duplex = "half";
  } else if (!["GET", "HEAD"].includes(init.method) && source.body) {
    init.body = await copyBody(source);
  }
  return new RequestConstructor(resource(input.url), init);
}
