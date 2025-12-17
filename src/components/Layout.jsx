
import { Outlet } from 'react-router-dom';
import Footer from "./Footer"; // Optional
import HeaderBar from './HeaderBar'; // or '@components/HeaderBar'


function Layout() {
  return (
    <>
      <HeaderBar />
      <main className="min-h-screen">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

export default Layout;
