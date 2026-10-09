import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PublicLayout from "./layouts/PublicLayout";
import CustomerLayout from "./layouts/CustomerLayout";
import Landing from "./pages/public/Landing";
import GetStarted from "./pages/public/GetStarted";
import Auth from "./pages/auth/Auth";
import Home from "./pages/customer/Home";
import Shops from "./pages/customer/Shops";
import ShopDetail from "./pages/customer/ShopDetail";
import Booking from "./pages/customer/Booking";
import Confirmed from "./pages/customer/Confirmed";
import PaymentStatus from "./pages/customer/PaymentStatus";
import MyQueue from "./pages/customer/MyQueue";
import CustomerReviews from "./pages/customer/Reviews";
import {
  Bookings,
  Payments as CustomerPayments,
  Notifications,
  Profile,
  Settings,
} from "./pages/customer/Lists";
import Complaints from "./pages/customer/Complaints";
import { useAuth } from "./hooks/useAuth";
import { OwnerProvider } from "./hooks/useOwnerStore";
import OwnerLayout from "./layouts/OwnerLayout";
import ShopLayout from "./layouts/ShopLayout";
import ShopAuth from "./pages/auth/ShopAuth";
import AdminLayout from "./layouts/AdminLayout";
import Dashboard from "./pages/owner/Dashboard";
import MyShops from "./pages/owner/MyShops";
import CreateShop from "./pages/owner/CreateShop";
import {
  Overview,
  Details,
  Photos,
  Location,
  Hours,
  Policies,
} from "./pages/owner/ShopPages";
import Queue from "./pages/owner/Queue";
import Barbers from "./pages/owner/Barbers";
import Services from "./pages/owner/Services";
import AllShopServices from "./pages/owner/AllShopServices";
import { Payments, Customers, Earnings, Reviews } from "./pages/owner/Business";
import {
  Notifications as ONotifications,
  Profile as OProfile,
  Settings as OSettings,
} from "./pages/owner/Account";
import {
  AdminDashboard,
  ShopApprovals,
  AllShops,
  Owners,
  Customers as AdminCustomers,
  Barbers as AdminBarbers,
  Payments as AdminPayments,
  Refunds,
  Complaints as AdminComplaints,
  Reviews as AdminReviews,
  AdminNotifications,
  Security,
  AdminSettings,
} from "./pages/admin/AdminPages";

const OwnerGuard = ({ children }) => {
  const a = useAuth();
  return a.isAuthed && a.role === "owner" ? (
    children
  ) : a.role === "shop" ? (
    <Navigate to="/shop" />
  ) : (
    <Navigate to="/sign-in?role=owner" />
  );
};
const AdminGuard = ({ children }) => {
  const a = useAuth();
  return a.isAuthed && a.role === "admin" ? (
    children
  ) : (
    <Navigate to="/sign-in?role=admin" />
  );
};
const ShopGuard = ({ children }) => {
  const a = useAuth();
  return a.isAuthed && a.role === "shop" && a.shopId ? (
    children
  ) : (
    <Navigate to="/shop-sign-in" />
  );
};
const Guard = ({ children }) => {
  const a = useAuth();
  return a.isAuthed ? (
    a.role === "owner" ? (
      <Navigate to="/owner" />
    ) : a.role === "admin" ? (
      <Navigate to="/admin" />
    ) : a.role === "shop" ? (
      <Navigate to="/shop" />
    ) : (
      children
    )
  ) : (
    <Navigate to="/sign-in" />
  );
};

export default function App() {
  return (
    <OwnerProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Landing />} />
          </Route>
          <Route path="/get-started" element={<GetStarted />} />
          <Route path="/sign-in" element={<Auth mode="signin" />} />
          <Route path="/create-account" element={<Auth mode="create" />} />
          <Route path="/shop-sign-in" element={<ShopAuth />} />
          <Route path="/forgot-password" element={<Auth mode="forgot" />} />
          <Route path="/reset-password" element={<Auth mode="reset" />} />

          <Route
            path="/app"
            element={
              <Guard>
                <CustomerLayout />
              </Guard>
            }
          >
            <Route index element={<Home />} />
            <Route path="shops" element={<Shops />} />
            <Route path="shops/:id" element={<ShopDetail />} />
            <Route path="book/:id" element={<Booking />} />
            <Route path="queue" element={<MyQueue />} />
            <Route path="queue/confirmed" element={<Confirmed />} />
            <Route
              path="queue/payment/:bookingId"
              element={<PaymentStatus />}
            />
            <Route path="bookings" element={<Bookings />} />
            <Route path="payments" element={<CustomerPayments />} />
            <Route path="reviews" element={<CustomerReviews />} />
            <Route path="complaints" element={<Complaints />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          <Route
            path="/owner"
            element={
              <OwnerGuard>
                <OwnerLayout />
              </OwnerGuard>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="shops" element={<MyShops />} />
            <Route path="create-shop" element={<CreateShop />} />
            <Route path="shop" element={<Overview />} />
            <Route path="shop/details" element={<Details />} />
            <Route path="shop/photos" element={<Photos />} />
            <Route path="shop/location" element={<Location />} />
            <Route path="shop/hours" element={<Hours />} />
            <Route path="shop/policies" element={<Policies />} />
            <Route path="queue" element={<Queue />} />
            <Route path="barbers" element={<Barbers />} />
            <Route path="services" element={<Services />} />
            <Route path="all-services" element={<AllShopServices />} />
            <Route path="customers" element={<Customers />} />
            <Route path="payments" element={<Payments />} />
            <Route path="earnings" element={<Earnings />} />
            <Route path="reviews" element={<Reviews />} />
            <Route path="notifications" element={<ONotifications />} />
            <Route path="profile" element={<OProfile />} />
            <Route path="settings" element={<OSettings />} />
          </Route>

          <Route
            path="/shop"
            element={
              <ShopGuard>
                <ShopLayout />
              </ShopGuard>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="shop" element={<Overview />} />
            <Route path="shop/details" element={<Details />} />
            <Route path="shop/photos" element={<Photos />} />
            <Route path="shop/location" element={<Location />} />
            <Route path="shop/hours" element={<Hours />} />
            <Route path="shop/policies" element={<Policies />} />
            <Route path="queue" element={<Queue />} />
            <Route path="barbers" element={<Barbers />} />
            <Route path="services" element={<Services />} />
            <Route path="customers" element={<Customers />} />
            <Route path="payments" element={<Payments />} />
            <Route path="earnings" element={<Earnings />} />
            <Route path="reviews" element={<Reviews />} />
            <Route path="notifications" element={<ONotifications />} />
            <Route path="profile" element={<OProfile />} />
            <Route path="settings" element={<OSettings />} />
          </Route>

          <Route
            path="/admin"
            element={
              <AdminGuard>
                <AdminLayout />
              </AdminGuard>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="approvals" element={<ShopApprovals />} />
            <Route path="shops" element={<AllShops />} />
            <Route path="owners" element={<Owners />} />
            <Route path="customers" element={<AdminCustomers />} />
            <Route path="barbers" element={<AdminBarbers />} />
            <Route path="payments" element={<AdminPayments />} />
            <Route path="refunds" element={<Refunds />} />
            <Route path="complaints" element={<AdminComplaints />} />
            <Route path="reviews" element={<AdminReviews />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="security" element={<Security />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </OwnerProvider>
  );
}
