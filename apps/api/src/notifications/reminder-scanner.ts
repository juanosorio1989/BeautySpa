import { Injectable } from "@nestjs/common";

/** Enqueues due appointment reminders; run by the worker's `scan-reminders` job. */
@Injectable()
export class ReminderScanner {
  /** TODO(plan 05, Task 7): find appointments entering the 24 h / 2 h windows and add `send` jobs. Returns jobs added. */
  scan(): Promise<number> {
    return Promise.resolve(0);
  }
}
