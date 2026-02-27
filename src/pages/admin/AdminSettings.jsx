import React from 'react';
import { Settings, Globe, Bell, Lock, CreditCard } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';

const AdminSettings = ({ user, adminRole }) => {
  // Only super_admin can access this page
  if (adminRole !== 'super_admin') {
    return (
      <AdminLayout user={user} adminRole={adminRole} pageTitle="Settings">
        <div className="bg-yellow-50 text-yellow-800 p-4 rounded-lg">
          <p className="font-semibold">Access Denied</p>
          <p className="text-sm mt-1">Only super admins can access settings.</p>
        </div>
      </AdminLayout>
    );
  }

  const settingsSections = [
    {
      icon: Globe,
      title: 'General Settings',
      description: 'Site name, logo, contact information',
      color: 'blue'
    },
    {
      icon: Bell,
      title: 'Notifications',
      description: 'Email notifications, order alerts',
      color: 'green'
    },
    {
      icon: Lock,
      title: 'Security',
      description: 'Password policy, two-factor authentication',
      color: 'red'
    },
    {
      icon: CreditCard,
      title: 'Payment Settings',
      description: 'Payment gateways, tax configuration',
      color: 'purple'
    }
  ];

  const getColorClasses = (color) => {
    const colors = {
      blue: 'bg-blue-100 text-blue-600',
      green: 'bg-green-100 text-green-600',
      red: 'bg-red-100 text-red-600',
      purple: 'bg-purple-100 text-purple-600'
    };
    return colors[color] || colors.blue;
  };

  return (
    <AdminLayout user={user} adminRole={adminRole} pageTitle="Settings">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
            <Settings className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-600 mt-1">
              Configure your store settings and preferences
            </p>
          </div>
        </div>
      </div>

      {/* Settings Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {settingsSections.map((section) => {
          const Icon = section.icon;
          return (
            <div
              key={section.title}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-start space-x-4">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${getColorClasses(section.color)}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">
                    {section.title}
                  </h3>
                  <p className="text-sm text-gray-600">{section.description}</p>
                  <p className="text-xs text-gray-400 mt-3">Coming soon</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Placeholder Info */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Note:</span> Settings configuration features are
          currently under development. Check back soon for full settings management capabilities.
        </p>
      </div>
    </AdminLayout>
  );
};

export default AdminSettings;
