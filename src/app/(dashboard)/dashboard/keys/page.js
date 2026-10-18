import { getMachineId } from "@/shared/utils/machine";
import APIPageClient from "../endpoint/EndpointPageClient";

export default async function ApiKeysPage() {
  const machineId = await getMachineId();
  return <APIPageClient machineId={machineId} view="keys" />;
}
