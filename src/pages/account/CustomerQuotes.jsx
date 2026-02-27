import React from 'react';
import { FileText } from 'lucide-react';
import CustomerLayout from '../../components/customer/CustomerLayout';

const CustomerQuotes = ({ user }) => {
  return (
    <CustomerLayout user={user} pageTitle="My Quotes">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Quotes Feature Coming Soon</h3>
        <p className="text-gray-600">
          Request and manage product quotes will be available here.
        </p>
      </div>
    </CustomerLayout>
  );
};

export default CustomerQuotes;
