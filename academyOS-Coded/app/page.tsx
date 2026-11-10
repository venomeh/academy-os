import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Marquee from "@/components/Marquee";
import Problem from "@/components/Problem";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import Stats from "@/components/Stats";
import UrduQuote from "@/components/UrduQuote";
import Pricing from "@/components/Pricing";
import Faq from "@/components/Faq";
import WaitlistCta from "@/components/WaitlistCta";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main id="top" style={{ display: "block" }}>
        {/* bright */}
        <Hero />
        {/* ink */}
        <Marquee />
        {/* paper */}
        <Problem />
        {/* ink */}
        <Features />
        {/* paper */}
        <HowItWorks />
        {/* ink */}
        <Stats />
        {/* paper */}
        <UrduQuote />
        {/* ink */}
        <Pricing />
        {/* paper */}
        <Faq />
        {/* bright */}
        <WaitlistCta />
      </main>
      {/* ink */}
      <Footer />
    </>
  );
}
