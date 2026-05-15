import type { Metadata } from "next";
import { Workspace } from "@/components/punch/Workspace";

export const metadata: Metadata = {
  title: "Punch",
  description: "Punch a sticker out of a notebook photo.",
};

export default function PunchPage() {
  return <Workspace />;
}
