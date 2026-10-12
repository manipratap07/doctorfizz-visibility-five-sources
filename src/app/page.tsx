import StructuredData from "@/components/StructuredData";
import Tool from "@/components/Tool";
import { getToolConfig } from "@/lib/backend";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ check?: string }>;
}) {
  const check = (await searchParams).check;
  const initialCheckId =
    check && /^[a-f0-9-]{36}$/.test(check) ? check : undefined;
  const config = await getToolConfig();
  return (
    <>
      <StructuredData />
      <Tool
        providers={config.providers}
        turnstileKey={config.turnstileKey}
        initialCheckId={initialCheckId}
      />
    </>
  );
}
