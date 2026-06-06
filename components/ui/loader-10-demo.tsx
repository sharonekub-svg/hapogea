import { GooeyLoader } from "@/components/ui/loader-10";

export default function GooeyLoaderDemo() {
  return (
    <div className="flex items-center justify-center w-full min-h-[250px]">
      <GooeyLoader
        primaryColor="#55d6ff"
        secondaryColor="#2563eb"
        borderColor="rgba(85,214,255,0.3)"
      />
    </div>
  );
}
