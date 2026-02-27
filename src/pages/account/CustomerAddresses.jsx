import React from 'react';
import { MapPin } from 'lucide-react';
import CustomerLayout from '../../components/customer/CustomerLayout';

const CustomerAddresses = ({ user }) => {
  return (
    <CustomerLayout user={user} pageTitle="Addresses">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
              <MapPin className="h-5 w-5" />
              <span>Billing Address</span>
            </h2>
            <button className="text-sm text-blue-600 hover:text-blue-700 font-semibold">
              Edit
            </button>
          </div>
          <p className="text-sm text-gray-500">No billing address saved</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
              <MapPin className="h-5 w-5" />
              <span>Shipping Address</span>
            </h2>
            <button className="text-sm text-blue-600 hover:text-blue-700 font-semibold">
              Edit
            </button>
          </div>
          <p className="text-sm text-gray-500">No shipping address saved</p>
        </div>
      </div>
    </CustomerLayout>
  );
};

export default CustomerAddresses;
