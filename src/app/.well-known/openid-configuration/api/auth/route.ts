import { issuerMetadata } from "@/lib/issuer-metadata";

export const GET = () => issuerMetadata("openid-configuration");
