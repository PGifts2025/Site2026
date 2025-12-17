
// Canvas utility functions for the design tool

export const exportCanvasAsImage = (canvas, format = 'jpeg', quality = 0.9) => {
  return canvas.toDataURL(`image/${format}`, quality);
};

export const exportCanvasAsSVG = (canvas) => {
  return canvas.toSVG();
};

export const exportCanvasAsPDF = async (canvas, filename = 'design.pdf') => {
  const { jsPDF } = await import('jspdf');
  
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [canvas.width, canvas.height]
  });

  const imgData = canvas.toDataURL('image/jpeg', 0.9);
  pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
  
  return pdf;
};

export const loadImageToCanvas = (canvas, file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (event) => {
      const imgUrl = event.target.result;
      
      if (file.type === 'image/svg+xml') {
        fabric.loadSVGFromString(imgUrl).then((result) => {
          const obj = fabric.util.groupSVGElements(result.objects, result.options);
          obj.set({
            left: 100,
            top: 100,
            scaleX: 0.5,
            scaleY: 0.5
          });
          canvas.add(obj);
          canvas.renderAll();
          resolve(obj);
        }).catch((error) => {
          console.error('Error loading SVG:', error);
          reject(error);
        });
      } else {
        fabric.Image.fromURL(imgUrl).then((img) => {
          // Scale image to fit canvas if too large
          const maxWidth = canvas.width * 0.8;
          const maxHeight = canvas.height * 0.8;
          
          if (img.width > maxWidth || img.height > maxHeight) {
            const scaleX = maxWidth / img.width;
            const scaleY = maxHeight / img.height;
            const scale = Math.min(scaleX, scaleY);
            
            img.set({
              scaleX: scale,
              scaleY: scale
            });
          }
          
          img.set({
            left: 100,
            top: 100
          });
          
          canvas.add(img);
          canvas.renderAll();
          resolve(img);
        }).catch((error) => {
          console.error('Error loading image:', error);
          reject(error);
        });
      }
    };
    
    reader.onerror = reject;
    
    if (file.type === 'image/svg+xml') {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  });
};

export const addWatermark = (canvas, text = 'PROMO GIFTS - SIGN IN TO REMOVE WATERMARK') => {
  const watermark = new fabric.Text(text, {
    left: canvas.width / 2,
    top: canvas.height / 2,
    fontSize: Math.min(canvas.width, canvas.height) / 20,
    fill: 'rgba(255, 0, 0, 0.3)',
    angle: -45,
    selectable: false,
    evented: false,
    id: 'watermark',
    originX: 'center',
    originY: 'center'
  });
  
  canvas.add(watermark);
  canvas.renderAll();
  return watermark;
};

export const removeWatermark = (canvas) => {
  const objects = canvas.getObjects();
  const watermark = objects.find(obj => obj.id === 'watermark');
  if (watermark) {
    canvas.remove(watermark);
    canvas.renderAll();
  }
};

export const addPrintAreaGuide = (canvas, area) => {
  // Remove existing guides
  const objects = canvas.getObjects();
  objects.forEach(obj => {
    if (obj.id === 'print-area-guide') {
      canvas.remove(obj);
    }
  });

  // Add new guide
  const guide = new fabric.Rect({
    left: area.x,
    top: area.y,
    width: area.width,
    height: area.height,
    fill: 'transparent',
    stroke: '#ff0000',
    strokeWidth: 2,
    strokeDashArray: [5, 5],
    selectable: false,
    evented: false,
    id: 'print-area-guide'
  });
  
  canvas.add(guide);
  canvas.sendObjectToBack(guide);
  canvas.renderAll();
  return guide;
};

export const centerObject = (canvas, object) => {
  object.set({
    left: canvas.width / 2,
    top: canvas.height / 2,
    originX: 'center',
    originY: 'center'
  });
  canvas.renderAll();
};

export const duplicateObject = (canvas, object) => {
  object.clone((cloned) => {
    cloned.set({
      left: cloned.left + 10,
      top: cloned.top + 10
    });
    canvas.add(cloned);
    canvas.setActiveObject(cloned);
    canvas.renderAll();
  });
};

export const alignObjects = (canvas, alignment) => {
  const activeObjects = canvas.getActiveObjects();
  if (activeObjects.length < 2) return;

  const bounds = {
    left: Math.min(...activeObjects.map(obj => obj.left)),
    top: Math.min(...activeObjects.map(obj => obj.top)),
    right: Math.max(...activeObjects.map(obj => obj.left + obj.width * obj.scaleX)),
    bottom: Math.max(...activeObjects.map(obj => obj.top + obj.height * obj.scaleY))
  };

  activeObjects.forEach(obj => {
    switch (alignment) {
      case 'left':
        obj.set({ left: bounds.left });
        break;
      case 'center':
        obj.set({ left: bounds.left + (bounds.right - bounds.left) / 2 - (obj.width * obj.scaleX) / 2 });
        break;
      case 'right':
        obj.set({ left: bounds.right - obj.width * obj.scaleX });
        break;
      case 'top':
        obj.set({ top: bounds.top });
        break;
      case 'middle':
        obj.set({ top: bounds.top + (bounds.bottom - bounds.top) / 2 - (obj.height * obj.scaleY) / 2 });
        break;
      case 'bottom':
        obj.set({ top: bounds.bottom - obj.height * obj.scaleY });
        break;
    }
  });

  canvas.renderAll();
};
