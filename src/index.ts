import { Hono } from "hono";
import type { AppEnv } from "./env";

const app = new Hono<AppEnv>();

export default app;
