import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import { ZodValidationException } from "nestjs-zod";
import { ErrorCode, type Problem } from "@beautyspa/contracts";

const STATUS_CODES: Record<number, ErrorCode> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
};

function codeForStatus(status: number): ErrorCode {
  return STATUS_CODES[status] ?? "INTERNAL";
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblem(exception);
    if (problem.status >= 500) this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(problem.status).type("application/problem+json").send(JSON.stringify(problem));
  }

  private toProblem(exception: unknown): Problem {
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as { issues?: { path: (string | number)[]; message: string }[] };
      const errors = (zodError.issues ?? []).map((i) => ({ path: i.path.join("."), message: i.message }));
      return { type: "about:blank", title: "Validation failed", status: 400, code: "VALIDATION_FAILED", errors };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const parsedCode = typeof body === "object" && body !== null ? ErrorCode.safeParse((body as { code?: unknown }).code) : undefined;
      const code = parsedCode?.success ? parsedCode.data : codeForStatus(status);
      const detail = typeof body === "string" ? body : (body as { message?: unknown }).message;
      return {
        type: "about:blank",
        title: HttpStatus[status]?.replaceAll("_", " ") ?? "Error",
        status,
        code,
        ...(typeof detail === "string" ? { detail } : {}),
      };
    }
    return { type: "about:blank", title: "Internal Server Error", status: 500, code: "INTERNAL" };
  }
}
