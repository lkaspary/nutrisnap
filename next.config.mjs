/** @type {import('next').NextConfig} */
const isNativeBuild = process.env.NEXT_OUTPUT === "export";

const nextConfig = {
  ...(isNativeBuild ? { output: "export" } : {}),
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
