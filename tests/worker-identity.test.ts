import { expect, it } from "vitest";
import { Queue } from "bullmq";
import { workerIdentity } from "../src/lib/worker-identity";

it("uses the Redis client identity returned by BullMQ instead of the queue name", () => {
  const parse = (
    Queue.prototype as unknown as {
      parseClientList(
        list: string,
        matcher: (name: string) => boolean,
      ): { name: string; rawname: string }[];
    }
  ).parseClientList;
  const identity = "bull:YnJvd3Nlci1wcm92aWRlcg:w:doctorfizz-0123456789abcdef";
  const workers = parse.call(
    { name: "browser-provider" } as never,
    `id=12 name=${identity} cmd=brpoplpush\nid=13 name=other-queue cmd=brpoplpush`,
    (name) => name === identity,
  );
  expect(workers[0].name).toBe("browser-provider");
  expect(workers.map(workerIdentity)).toEqual([{ name: identity }]);
  expect(
    workerIdentity(workers[0]).name.endsWith(":w:doctorfizz-0123456789abcdef"),
  ).toBe(true);
});
