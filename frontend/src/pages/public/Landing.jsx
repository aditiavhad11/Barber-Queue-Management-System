import { Link } from "react-router-dom";
const steps = [["Find a Shop","Browse approved barber shops near you, with live queue information."],["Choose Your Service","Pick what you need. Price and duration are shown up front."],["Select Your Barber","Prefer someone? Compare ratings and waiting time. Solo shops are assigned automatically."],["Join the Queue","Pay once and get your token number."],["Know When It's Your Turn","Follow your position and estimated turn time live."]];
export default function Landing() {
  return <>
    <header className="relative min-h-[92vh] flex items-end bg-side text-cream">
      <img src="https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1800&q=70" alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
      <div className="absolute inset-0 bg-black/70" />
      <div className="absolute top-0 inset-x-0 flex justify-between items-center px-6 md:px-16 py-6 z-10"><span className="font-serif text-2xl">Barber Queue</span><Link to="/sign-in" className="text-sm border-b border-brass pb-0.5">Sign In</Link></div>
      <div className="relative z-10 px-6 md:px-16 pb-16 md:pb-24 max-w-3xl fade">
        <p className="label !text-gold mb-5">Skip the wait, keep your place</p>
        <h1 className="text-5xl md:text-7xl leading-[1.02]">Your time matters.<br />Your barber is ready.</h1>
        <p className="mt-6 max-w-lg text-cream/80 leading-relaxed">Discover nearby barber shops, choose a service, pick your barber and join the queue from wherever you are.</p>
        <div className="mt-8 flex flex-wrap gap-4"><Link to="/get-started" className="btn">Find a Barber</Link><a href="#how" className="btn-ghost !text-cream !border-cream/60 hover:!bg-cream hover:!text-side">How It Works</a></div>
      </div>
    </header>
    <section id="how" className="px-6 md:px-16 py-20 md:py-28">
      <p className="label">The journey</p><h2 className="text-4xl md:text-5xl mt-2 mb-12">How It Works</h2>
      <ol className="border-t border-khaki">{steps.map(([t,d],i) => <li key={t} className="grid md:grid-cols-[120px_1fr_1.2fr] gap-2 md:gap-8 py-7 border-b border-khaki items-baseline"><span className="font-serif text-4xl text-gold">0{i+1}</span><h3 className="text-2xl">{t}</h3><p className="text-coffee/70 max-w-md">{d}</p></li>)}</ol>
    </section>
    <section id="about" className="px-6 md:px-16 pb-24 grid md:grid-cols-2 gap-10">
      <h2 className="text-4xl md:text-5xl">Waiting should not be a guessing game.</h2>
      <p className="text-coffee/75 leading-relaxed max-w-xl">Barber Queue helps customers find shops, choose services and a preferred barber, and follow their place in line. Estimated waiting time is calculated from the service durations of the customers ahead of you, so what you see is simple and predictable.</p>
    </section></>;
}
