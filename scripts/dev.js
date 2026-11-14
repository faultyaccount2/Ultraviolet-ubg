import { execFileSync } from "node:child_process";
import proxy from "../api/proxy.js";
import { startServer } from "./server.js";

execFileSync(process.execPath, ["scripts/build.js"], { stdio: "inherit" });
startServer(proxy, Number(process.env.PORT || 3000));
