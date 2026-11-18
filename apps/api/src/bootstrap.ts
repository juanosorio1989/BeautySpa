import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { ZodValidationPipe, cleanupOpenApiDoc } from "nestjs-zod";
import { ProblemFilter } from "./common/problem.filter.js";
import type { Env } from "./config/env.js";

export async function configureApp(app: INestApplication, env: Env): Promise<void> {
  app.setGlobalPrefix("v1");
  app.use(helmet());
  app.enableCors({ origin: [env.WEB_ORIGIN], credentials: true });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemFilter());

  const config = new DocumentBuilder().setTitle("BeautySpa API").setVersion("1.0").build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  SwaggerModule.setup("v1/docs", app, document, { jsonDocumentUrl: "v1/openapi.json" });
}
