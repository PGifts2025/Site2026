
import React from 'react';
import { ChevronDown, Eye, EyeOff, Settings } from 'lucide-react';

const PrintAreaSelector = ({ 
  printAreas, 
  selectedArea, 
  onAreaChange, 
  showOverlay = true, 
  onToggleOverlay,
  onOpenAdmin,
  isAdmin = false
}) => {
  const availableAreas = Object.keys(printAreas || {});

  if (availableAreas.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-yellow-800">No Print Areas Configured</h4>
            <p className="text-sm text-yellow-600 mt-1">
              This product doesn't have any print areas configured yet.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={onOpenAdmin}
              className="flex items-center space-x-1 px-3 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 text-sm"
            >
              <Settings className="w-4 h-4" />
              <span>Configure</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (availableAreas.length === 1) {
    const singleArea = printAreas[availableAreas[0]];
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-medium text-gray-700">Print Area</label>
            <p className="text-sm text-gray-500">{singleArea.name}</p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onToggleOverlay}
              className={`flex items-center space-x-1 px-2 py-1 rounded text-sm ${
                showOverlay 
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title={showOverlay ? 'Hide print area guide' : 'Show print area guide'}
            >
              {showOverlay ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              <span>Guide</span>
            </button>
            {isAdmin && (
              <button
                onClick={onOpenAdmin}
                className="flex items-center space-x-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-sm hover:bg-gray-200"
                title="Configure print areas"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-sm text-blue-800">
            <div className="font-medium">Print Area Details:</div>
            <div className="mt-1 space-y-1">
              <div>Maximum size: {singleArea.maxWidth || singleArea.width} × {singleArea.maxHeight || singleArea.height} pixels</div>
              <div>Position: {singleArea.x}, {singleArea.y}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">Print Area</label>
        <div className="flex items-center space-x-2">
          <button
            onClick={onToggleOverlay}
            className={`flex items-center space-x-1 px-2 py-1 rounded text-sm ${
              showOverlay 
                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title={showOverlay ? 'Hide print area guide' : 'Show print area guide'}
          >
            {showOverlay ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            <span>Guide</span>
          </button>
          {isAdmin && (
            <button
              onClick={onOpenAdmin}
              className="flex items-center space-x-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-sm hover:bg-gray-200"
              title="Configure print areas"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        <select
          value={selectedArea}
          onChange={(e) => onAreaChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
        >
          {availableAreas.map((areaKey) => (
            <option key={areaKey} value={areaKey}>
              {printAreas[areaKey].name}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>

      {selectedArea && printAreas[selectedArea] && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-sm text-blue-800">
            <div className="font-medium">Print Area Details:</div>
            <div className="mt-1 space-y-1">
              <div>Maximum size: {printAreas[selectedArea].maxWidth || printAreas[selectedArea].width} × {printAreas[selectedArea].maxHeight || printAreas[selectedArea].height} pixels</div>
              <div>Position: {printAreas[selectedArea].x}, {printAreas[selectedArea].y}</div>
            </div>
          </div>
        </div>
      )}

      {/* Print Area Preview Grid */}
      <div className="grid grid-cols-2 gap-2">
        {availableAreas.map((areaKey) => (
          <button
            key={areaKey}
            onClick={() => onAreaChange(areaKey)}
            className={`p-3 border rounded-lg text-left transition-colors ${
              selectedArea === areaKey
                ? 'border-blue-500 bg-blue-50 text-blue-900'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="font-medium text-sm">{printAreas[areaKey].name}</div>
            <div className="text-xs text-gray-500 mt-1">
              {printAreas[areaKey].width} × {printAreas[areaKey].height}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PrintAreaSelector;
