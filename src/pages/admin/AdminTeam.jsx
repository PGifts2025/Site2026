import React, { useState, useEffect } from 'react';
import { UserPlus, Mail, Shield, CheckCircle, XCircle, Loader } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';
import { supabase } from '../../services/supabaseService';

const AdminTeam = ({ user, adminRole }) => {
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);

  // Only super_admin can access this page
  if (adminRole !== 'super_admin') {
    return (
      <AdminLayout user={user} adminRole={adminRole} pageTitle="Team">
        <div className="bg-yellow-50 text-yellow-800 p-4 rounded-lg">
          <p className="font-semibold">Access Denied</p>
          <p className="text-sm mt-1">Only super admins can manage team members.</p>
        </div>
      </AdminLayout>
    );
  }

  useEffect(() => {
    fetchTeamMembers();
  }, []);

  const fetchTeamMembers = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setTeamMembers(data || []);
    } catch (error) {
      console.error('[AdminTeam] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const getRoleBadgeClass = (role) => {
    return role === 'super_admin'
      ? 'bg-purple-100 text-purple-800'
      : 'bg-blue-100 text-blue-800';
  };

  return (
    <AdminLayout user={user} adminRole={adminRole} pageTitle="Team Management">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
            <p className="text-sm text-gray-600 mt-1">
              Manage admin access for your team
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            <span>Add Member</span>
          </button>
        </div>
      </div>

      {/* Team Members List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-8 w-8 text-blue-600 animate-spin" />
          </div>
        ) : teamMembers.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No team members yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-600 border-b border-gray-200 bg-gray-50">
                  <th className="px-6 py-4 font-semibold">Name</th>
                  <th className="px-6 py-4 font-semibold">Email</th>
                  <th className="px-6 py-4 font-semibold">Role</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 font-semibold">Added</th>
                  <th className="px-6 py-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {teamMembers.map((member) => (
                  <tr
                    key={member.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {member.first_name} {member.last_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <div className="flex items-center space-x-2">
                        <Mail className="h-4 w-4 text-gray-400" />
                        <span>{member.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-full ${getRoleBadgeClass(
                          member.role
                        )}`}
                      >
                        <Shield className="h-3 w-3" />
                        <span>{member.role.replace('_', ' ')}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {member.is_active ? (
                        <span className="inline-flex items-center space-x-1 text-green-600 text-sm">
                          <CheckCircle className="h-4 w-4" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 text-gray-400 text-sm">
                          <XCircle className="h-4 w-4" />
                          <span>Inactive</span>
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {formatDate(member.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <button className="text-sm text-blue-600 hover:text-blue-700 font-semibold mr-3">
                        Edit
                      </button>
                      {member.is_active ? (
                        <button className="text-sm text-red-600 hover:text-red-700 font-semibold">
                          Deactivate
                        </button>
                      ) : (
                        <button className="text-sm text-green-600 hover:text-green-700 font-semibold">
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Member Modal - Placeholder */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Add Team Member</h2>
            <p className="text-sm text-gray-600 mb-4">
              Feature coming soon: Send invitation to new team member
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export default AdminTeam;
