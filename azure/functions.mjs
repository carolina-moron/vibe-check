// Azure Functions v4 host for the Vibe Check agent skills. Same routes as scripts/agent-server.mjs,
// so docs/agent-openapi.yaml applies unchanged. Deploy with infra/deploy.sh.
import { app } from "@azure/functions";
import { handle, PUBLIC } from "../scripts/agent-server.mjs";

const wrap = async (req) => {
  const token = process.env.AGENT_TOKEN;
  const path = "/" + (req.params.path || "");
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
  if (req.method === "OPTIONS") return { status: 204, headers: cors };
  if (token && !PUBLIC.has(`${req.method} ${path}`) && req.headers.get("authorization") !== `Bearer ${token}`) return { status: 401, headers: cors, jsonBody: { error: "unauthorised" } };
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  try { return { status: 200, headers: cors, jsonBody: await handle(req.method, path, body) }; }
  catch (e) { return { status: e.status || 500, headers: cors, jsonBody: { error: e.message } }; }
};

app.http("agent", { methods: ["GET", "POST", "OPTIONS"], authLevel: "anonymous", route: "{*path}", handler: wrap });
