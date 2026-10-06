const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT = __dirname;
const COMMENTS_FILE = path.join(ROOT, "comments.json");
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 10_000;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

if (!fs.existsSync(COMMENTS_FILE)) {
  fs.writeFileSync(COMMENTS_FILE, "{}\n", "utf8");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function readComments() {
  try {
    const data = JSON.parse(fs.readFileSync(COMMENTS_FILE, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function isValidPostSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/api/comments" && request.method === "GET") {
    const post = url.searchParams.get("post");
    if (!isValidPostSlug(post)) return sendJson(response, 400, { error: "Invalid post." });
    const comments = readComments()[post];
    return sendJson(response, 200, Array.isArray(comments) ? comments : []);
  }

  if (url.pathname === "/api/comments" && request.method === "POST") {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) tooLarge = true;
    });
    request.on("end", () => {
      if (tooLarge) return sendJson(response, 413, { error: "Comment request is too large." });

      let input;
      try {
        input = JSON.parse(body);
      } catch {
        return sendJson(response, 400, { error: "Invalid JSON." });
      }

      const post = typeof input.post === "string" ? input.post.trim() : "";
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!isValidPostSlug(post)) return sendJson(response, 400, { error: "Invalid post." });
      if (!name || name.length > 60) return sendJson(response, 400, { error: "Name must be between 1 and 60 characters." });
      if (!text || text.length > 2000) return sendJson(response, 400, { error: "Comment must be between 1 and 2000 characters." });

      const comments = readComments();
      if (!Array.isArray(comments[post])) comments[post] = [];
      const comment = {
        id: randomUUID(),
        name,
        text,
        createdAt: new Date().toISOString()
      };
      comments[post].push(comment);
      try {
        fs.writeFileSync(COMMENTS_FILE, `${JSON.stringify(comments, null, 2)}\n`, "utf8");
        return sendJson(response, 201, comment);
      } catch {
        return sendJson(response, 500, { error: "Could not save your comment." });
      }
    });
    return;
  }

  if (url.pathname.startsWith("/api/")) return sendJson(response, 404, { error: "Not found." });
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    return response.end("Method not allowed.");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    return response.end("Bad request.");
  }
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`) || filePath === COMMENTS_FILE) {
    response.writeHead(404);
    return response.end("Not found.");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      return response.end(error.code === "ENOENT" ? "Not found." : "Server error.");
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    if (request.method === "HEAD") return response.end();
    response.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Blog server running at http://localhost:${PORT}`);
});
