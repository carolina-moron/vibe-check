// Azure Functions v4 host for the Vibe Check agent skills. Same routes as scripts/agent-server.mjs,
// so docs/agent-openapi.yaml applies unchanged. Deploy with infra/deploy.sh.
import { app } from "@azure/functions";
import { handle } from "../scripts/agent-server.mjs";

const wrap = async (req) => {
  const token = process.env.AGENT_TOKEN;
  if (token && req.headers.get("authorization") !== `Bearer ${token}`) return { status: 401, jsonBody: { error: "unauthorised" } };
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const path = "/" + (req.params.path || "");
  try { return { status: 200, jsonBody: await handle(req.method, path, body) }; }
  catch (e) { return { status: e.status || 500, jsonBody: { error: e.message } }; }
};

app.http("agent", { methods: ["GET", "POST"], authLevel: "anonymous", route: "{*path}", handler: wrap });
