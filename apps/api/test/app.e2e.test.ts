import "reflect-metadata";
import { Body, Controller, INestApplication, Module, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProblemSchema } from "@beautyspa/contracts";
import { HealthModule } from "../src/health/health.module.js";
import { configureApp } from "../src/bootstrap.js";
import { loadEnv } from "../src/config/env.js";

class EchoDto extends createZodDto(z.object({ name: z.string() })) {}

@Controller("echo")
class EchoController {
  @Post()
  echo(@Body() body: EchoDto) {
    return body;
  }
}

@Module({ imports: [HealthModule], controllers: [EchoController] })
class TestModule {}

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  WEB_ORIGIN: "http://localhost:3000",
});

describe("api skeleton", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    await configureApp(app, env);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it("GET /v1/health returns ok with nosniff", async () => {
    const res = await request(app.getHttpServer()).get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("GET /v1/openapi.json lists /v1/health", async () => {
    const res = await request(app.getHttpServer()).get("/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.paths).toHaveProperty("/v1/health");
  });

  it("unknown route returns problem+json NOT_FOUND", async () => {
    const res = await request(app.getHttpServer()).get("/v1/nope");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(res.body.code).toBe("NOT_FOUND");
    expect(ProblemSchema.safeParse(res.body).success).toBe(true);
  });

  it("invalid body returns VALIDATION_FAILED with path", async () => {
    const res = await request(app.getHttpServer()).post("/v1/echo").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.errors[0].path).toBe("name");
  });

  it("malformed JSON returns VALIDATION_FAILED", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/echo")
      .set("content-type", "application/json")
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("CORS rejects unknown origin and echoes the allowed one", async () => {
    const evil = await request(app.getHttpServer())
      .options("/v1/health")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "GET");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    const ok = await request(app.getHttpServer())
      .options("/v1/health")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("loadEnv({}) throws naming DATABASE_URL", () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});
