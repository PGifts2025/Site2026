import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Eye, Loader, Mail, Phone, Building2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';
import { supabase } from '../../services/supabaseService';

const AdminCustomers = ({ user, adminRole }) => {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const customersPerPage = 20;

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    applySearch();
  }, [customers, searchQuery]);

  const fetchCustomers = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('customer_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get order counts for each customer
      const customersWithStats = await Promise.all(
        (data || []).map(async (customer) => {
          const { count: orderCount } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('customer_id', customer.id);

          const { data: orders } = await supabase
            .from('orders')
            .select('total_amount')
            .eq('customer_id', customer.id)
            .eq('status', 'completed');

          const totalSpent = orders?.reduce(
            (sum, order) => sum + (parseFloat(order.total_amount) || 0),
            0
          ) || 0;

          return {
            ...customer,
            order_count: orderCount || 0,
            total_spent: totalSpent
          };
        })
      );

      setCustomers(customersWithStats);
    } catch (error) {
      console.error('[AdminCustomers] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const applySearch = () => {
    if (!searchQuery) {
      setFilteredCustomers(customers);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = customers.filter(customer => {
      const name = `${customer.first_name} ${customer.last_name}`.toLowerCase();
      const email = (customer.email || '').toLowerCase();
      const company = (customer.company_name || '').toLowerCase();

      return name.includes(query) || email.includes(query) || company.includes(query);
    });

    setFilteredCustomers(filtered);
    setCurrentPage(1);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(amount || 0);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  // Pagination
  const totalPages = Math.ceil(filteredCustomers.length / customersPerPage);
  const startIndex = (currentPage - 1) * customersPerPage;
  const paginatedCustomers = filteredCustomers.slice(startIndex, startIndex + customersPerPage);

  return (
    <AdminLayout user={user} adminRole={adminRole} pageTitle="Customers">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, email, or company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <p className="text-sm text-gray-600 mt-4">
          Showing {filteredCustomers.length} {filteredCustomers.length === 1 ? 'customer' : 'customers'}
        </p>
      </div>

      {/* Customers Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-8 w-8 text-blue-600 animate-spin" />
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No customers found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-gray-600 border-b border-gray-200 bg-gray-50">
                    <th className="px-6 py-4 font-semibold">Name</th>
                    <th className="px-6 py-4 font-semibold">Company</th>
                    <th className="px-6 py-4 font-semibold">Contact</th>
                    <th className="px-6 py-4 font-semibold text-center">Orders</th>
                    <th className="px-6 py-4 font-semibold text-right">Total Spent</th>
                    <th className="px-6 py-4 font-semibold">Joined</th>
                    <th className="px-6 py-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedCustomers.map((customer) => (
                    <tr
                      key={customer.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {customer.first_name} {customer.last_name}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {customer.company_name ? (
                          <div className="flex items-center space-x-2">
                            <Building2 className="h-4 w-4 text-gray-400" />
                            <span>{customer.company_name}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <Mail className="h-3.5 w-3.5 text-gray-400" />
                            <span className="text-xs">{customer.email}</span>
                          </div>
                          {customer.phone && (
                            <div className="flex items-center space-x-2">
                              <Phone className="h-3.5 w-3.5 text-gray-400" />
                              <span className="text-xs">{customer.phone}</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-center font-semibold text-gray-900">
                        {customer.order_count}
                      </td>
                      <td className="px-6 py-4 text-sm text-right font-semibold text-gray-900">
                        {formatCurrency(customer.total_spent)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatDate(customer.created_at)}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          to={`/admin/customers/${customer.id}`}
                          className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-700 font-semibold text-sm"
                        >
                          <Eye className="h-4 w-4" />
                          <span>View</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </p>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
};

export default AdminCustomers;
