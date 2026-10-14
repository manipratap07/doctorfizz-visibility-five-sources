/** BullMQ getWorkers() puts the queue name in name and Redis identity in rawname. */
export function workerIdentity(worker: { name?: string; rawname?: string }) {
  return { name: worker.rawname || worker.name || "" };
}
