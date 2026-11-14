// SPDX-License-Identifier: GPL-3.0-or-later
import { createProxyHandler } from "../proxy/service.js";

export default createProxyHandler();
export const config = { api: { bodyParser: false } };
