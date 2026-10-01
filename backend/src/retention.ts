import { audit } from './audit.js';
import { purgeExpired } from './extractions/repo.js';

const HOUR = 60 * 60 * 1000;

/** Hourly retention sweep. Safe with multiple instances: DELETE is idempotent. */
export function startRetentionJob(log: { info: (o: object, m: string) => void; error: (e: unknown) => void }) {
  const run = async () => {
    try {
      const removed = await purgeExpired();
      if (removed) {
        await audit(null, 'retention.purge', undefined, { removed });
        log.info({ removed }, 'purged expired extractions');
      }
    } catch (err) {
      log.error(err);
    }
  };
  void run();
  const timer = setInterval(run, HOUR);
  timer.unref();
  return () => clearInterval(timer);
}
