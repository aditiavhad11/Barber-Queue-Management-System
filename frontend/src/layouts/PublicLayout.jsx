import { Link, Outlet } from "react-router-dom";
export default function PublicLayout() {
  return (
    <div>
      <Outlet />
      <footer className="bg-side text-cream/80 px-6 md:px-16 py-10 flex flex-wrap gap-6 justify-between text-sm">
        <span className="font-serif text-xl text-cream">Barber Queue</span>
        <nav className="flex flex-wrap gap-6">
          <a href="/#about">About</a>
          <a href="/#how">How It Works</a>
          <a href="#">Contact</a>
          <a href="#">Privacy Policy</a>
          <a href="#">Terms &amp; Conditions</a>
        </nav>
      </footer>
    </div>
  );
}
