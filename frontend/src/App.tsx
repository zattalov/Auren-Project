/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Layout, Type, Hash, Image as ImageIcon, Send, Monitor, ChevronRight, Plus, Trash2, CheckCircle, XCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from './lib/supabase';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

type ProjectTab = 'name-title' | 'keyword' | 'image';

interface NameTitle {
  name: string;
  title1: string;
  title2: string;
}

interface ImageEntry {
  file: File | null;
  source: string;
  aspectRatio: 'Vertical' | 'Horizontal' | 'Square' | '';
}

interface ProjectData {
  nameTitles: NameTitle[];
  keywords: string[];
  images: ImageEntry[];
  slugName: string;
  projectAspectRatio: 'Vertical' | 'Horizontal' | 'Square' | '';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ProjectTab>('name-title');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const dismissToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };
  const [data, setData] = useState<ProjectData>({
    nameTitles: [{ name: '', title1: '', title2: '' }],
    keywords: [''],
    images: [{ file: null, source: '', aspectRatio: '' }],
    slugName: '',
    projectAspectRatio: '',
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setData(prev => ({ ...prev, [name]: value }));
  };

  const handleNameTitleChange = (index: number, field: keyof NameTitle, value: string) => {
    const newNameTitles = [...data.nameTitles];
    newNameTitles[index] = { ...newNameTitles[index], [field]: value };
    setData(prev => ({ ...prev, nameTitles: newNameTitles }));
  };

  const addNameTitle = () => {
    setData(prev => ({
      ...prev,
      nameTitles: [...prev.nameTitles, { name: '', title1: '', title2: '' }]
    }));
  };

  const removeNameTitle = (index: number) => {
    if (data.nameTitles.length <= 1) return;
    const newNameTitles = data.nameTitles.filter((_, i) => i !== index);
    setData(prev => ({ ...prev, nameTitles: newNameTitles }));
  };

  const handleKeywordChange = (index: number, value: string) => {
    const newKeywords = [...data.keywords];
    newKeywords[index] = value;
    setData(prev => ({ ...prev, keywords: newKeywords }));
  };

  const addKeyword = () => {
    setData(prev => ({
      ...prev,
      keywords: [...prev.keywords, '']
    }));
  };

  const removeKeyword = (index: number) => {
    if (data.keywords.length <= 1) return;
    const newKeywords = data.keywords.filter((_, i) => i !== index);
    setData(prev => ({ ...prev, keywords: newKeywords }));
  };

  const handleImageEntryChange = (index: number, field: keyof ImageEntry, value: string) => {
    const newImages = [...data.images];
    newImages[index] = { ...newImages[index], [field]: value };
    setData(prev => ({ ...prev, images: newImages }));
  };

  const handleImageFileChange = (index: number, file: File | null) => {
    const newImages = [...data.images];
    newImages[index] = { ...newImages[index], file };
    setData(prev => ({ ...prev, images: newImages }));
  };

  const addImageEntry = () => {
    setData(prev => ({
      ...prev,
      images: [...prev.images, { file: null, source: '', aspectRatio: '' }]
    }));
  };

  const removeImageEntry = (index: number) => {
    if (data.images.length <= 1) return;
    const newImages = data.images.filter((_, i) => i !== index);
    setData(prev => ({ ...prev, images: newImages }));
  };

  const [isRendering, setIsRendering] = useState(false);
  const [renderStatus, setRenderStatus] = useState('');

  const handleRender = async () => {
    if (!data.slugName.trim()) {
      showToast('Please enter a Slug Name before rendering', 'error');
      return;
    }

    console.log('Rendering project with data:', data);

    // Filter out completely empty entries that the user hasn't filled
    const exportData = {
      ...data,
      nameTitles: data.nameTitles.filter(nt => nt.name.trim() !== '' || nt.title1.trim() !== '' || nt.title2.trim() !== ''),
      keywords: data.keywords.filter(k => k.trim() !== ''),
      images: data.images
        .filter(img => img.file || img.source.trim() !== '' || img.aspectRatio.trim() !== '')
        .map(img => ({
          source: img.source,
          aspectRatio: img.aspectRatio,
          fileName: img.file ? img.file.name : null,
          fileSize: img.file ? img.file.size : null,
        }))
    };

    // ── Step 1: Upload Images to Supabase (if any) ──
    setIsRendering(true);
    setRenderStatus('Uploading Images...');

    const uploadedImageNames: string[] = [];

    try {
      for (let i = 0; i < data.images.length; i++) {
        const img = data.images[i];
        if (img.file) {
          // Keep the original filename formatting
          const fileName = `${img.file.name}`;
          const cloudPath = `${data.slugName}/${fileName}`;
          
          const { error: uploadError } = await supabase
            .storage
            .from('project-files')
            .upload(cloudPath, img.file, {
              cacheControl: '3600',
              upsert: true
            });

          if (uploadError) {
             console.error('Image Upload Error:', uploadError);
             throw new Error(`Failed to upload ${fileName}: ${uploadError.message}`);
          }
        }
      }

      // ── Step 2: Create Render Job in Database ──
      setRenderStatus('Submitting Job...');

      const { data: jobData, error: dbError } = await supabase
        .from('render_jobs')
        .insert([{
            slug_name: data.slugName,
            status: 'pending',
            export_data: exportData
        }])
        .select()
        .single();
        
      if (dbError) {
          console.error('Database Insert Error:', dbError);
          throw new Error(`Failed to submit job: ${dbError.message}`);
      }

      showToast('Project data submitted! Render started.', 'success');

      // ── Step 3: Poll for Status in Database ──
      setRenderStatus('Waiting in Queue...');
      let isJobFinished = false;

      const pollStatus = async () => {
         if (isJobFinished) return;
         try {
            const { data: currentJob, error: checkError } = await supabase
                .from('render_jobs')
                .select('status, error_message')
                .eq('id', jobData.id)
                .single();
                
            if (checkError) throw checkError;

            if (currentJob.status === 'completed') {
                isJobFinished = true;
                setIsRendering(false);
                setRenderStatus('');
                showToast('Render complete!', 'success');
                return;
            }

            if (currentJob.status === 'failed' || currentJob.status === 'crashed') {
                isJobFinished = true;
                setIsRendering(false);
                setRenderStatus('');
                showToast(`Render failed: ${currentJob.error_message || 'Unknown error'}`, 'error');
                return;
            }
            
            // Still in queue or rendering
            setRenderStatus(currentJob.status === 'pending' ? 'Waiting in Queue...' : 'Rendering in After Effects...');
            setTimeout(pollStatus, 3000);
         } catch (error) {
             console.error('Polling Error:', error);
             // Still retry pooling on a simple network error
             setTimeout(pollStatus, 3000);
         }
      };

      setTimeout(pollStatus, 3000);

    } catch (error: any) {
      console.error('Error:', error);
      showToast(error.message || 'Error occurred while processing', 'error');
      setIsRendering(false);
      setRenderStatus('');
    }
  };

  const tabs = [
    { id: 'name-title', label: 'Name and Title', icon: Type },
    { id: 'keyword', label: 'Keyword', icon: Hash },
    { id: 'image', label: 'Image', icon: ImageIcon },
  ];

  return (
    <div className="flex h-screen bg-[#1A1A24] font-sans text-white">
      {/* Toast Notifications */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 100, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.9 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className={`flex items-center gap-3 px-5 py-4 rounded-[5px] shadow-lg border min-w-[320px] max-w-[480px] ${toast.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-red-50 border-red-200 text-red-800'
                }`}
            >
              {toast.type === 'success' ? (
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              )}
              <p className="text-sm font-medium flex-1">{toast.message}</p>
              <button
                onClick={() => dismissToast(toast.id)}
                className="p-1 hover:bg-black/5 rounded transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {/* Sidebar */}
      <aside className="w-72 bg-[#222330] border-r border-[#32364E] flex flex-col shadow-sm">
        <div className="p-8 border-bottom border-[#32364E] flex items-center gap-3">
          <div className="w-10 h-10 bg-[#32364E] rounded-[5px] flex items-center justify-center">
            <Monitor className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">AUREN</h1>
          </div>
        </div>

        <nav className="flex-1 px-4 py-8 space-y-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ProjectTab)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-[5px] transition-all duration-200 group ${activeTab === tab.id
                ? 'bg-[#32364E] text-white shadow-md'
                : 'hover:bg-[#2A2B3D] text-[#8F95B2]'
                }`}
            >
              <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? 'text-[#FAC800]' : 'text-[#646882] group-hover:text-white'}`} />
              <span className="font-medium text-sm">{tab.label}</span>
              {activeTab === tab.id && <ChevronRight className="ml-auto w-4 h-4 opacity-50" />}
            </button>
          ))}
        </nav>

        <div className="p-6 border-t border-[#32364E]">
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-20 bg-[#222330] border-b border-[#32364E] flex items-center justify-between px-10">
          <div className="flex items-center gap-2">
            <span className="text-[#646882] text-sm font-medium">Projects</span>
            <ChevronRight className="w-4 h-4 text-[#646882]" />
            <span className="text-sm font-bold capitalize text-white">{activeTab.replace('-', ' ')}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right mr-4">
              <p className="text-sm font-bold text-white">Jamel Eddine Ghabbara</p>
              <p className="text-[10px] text-[#8F95B2] uppercase font-bold tracking-wider">Sr. Motion Graphic Deisgner</p>
            </div>
            <div className="w-10 h-10 rounded-[5px] border-2 border-[#1E1E2E] shadow-sm overflow-hidden">
              <img src="https://picsum.photos/seed/admin/100/100" alt="Avatar" referrerPolicy="no-referrer" />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10 bg-[#1A1A24] pb-40 flex flex-col items-center">
          <div className="w-full transition-all duration-300 ease-in-out flex justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className={`bg-[#222330] rounded-[5px] p-10 shadow-sm border border-[#32364E] transition-all duration-300 ${(activeTab === 'name-title' && data.nameTitles.length > 1) ||
                  (activeTab === 'keyword' && data.keywords.length > 1) ||
                  (activeTab === 'image' && data.images.length > 1)
                  ? 'max-w-6xl w-full'
                  : 'max-w-2xl w-full'
                  }`}
              >
                <div className="mb-8 flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight mb-2 text-white">
                      {tabs.find(t => t.id === activeTab)?.label}
                    </h2>
                  </div>
                  {(activeTab === 'name-title' || activeTab === 'keyword' || activeTab === 'image') && (
                    <button
                      onClick={
                        activeTab === 'name-title' ? addNameTitle :
                          activeTab === 'keyword' ? addKeyword :
                            addImageEntry
                      }
                      className="p-3 bg-[#FAC800] text-black rounded-[5px] hover:bg-[#e5b600] transition-all shadow-md active:scale-95"
                      title="Add New Entry"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  )}
                </div>

                <div className="space-y-8">
                  {activeTab === 'name-title' && (
                    <div className={`grid gap-6 transition-all duration-300 ${data.nameTitles.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {data.nameTitles.map((item, index) => (
                        <div key={index} className="relative p-6 bg-[#1E1E2E] rounded-[5px] border border-[#32364E] space-y-6">
                          {data.nameTitles.length > 1 && (
                            <button
                              onClick={() => removeNameTitle(index)}
                              className="absolute -top-3 -right-3 p-2 bg-[#222330] border border-[#32364E] text-red-500 rounded-[5px] hover:bg-red-500/10 transition-all shadow-sm z-20"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-wider text-[#646882]">Name {index + 1}</label>
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => handleNameTitleChange(index, 'name', e.target.value)}
                              placeholder="Enter Person Name"
                              className="w-full px-5 py-4 bg-[#16161F] border border-[#454964] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-[#FAC800]/20 focus:border-[#FAC800] transition-all text-white placeholder-[#646882]"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-wider text-[#646882]">Title 1</label>
                              <input
                                type="text"
                                value={item.title1}
                                onChange={(e) => handleNameTitleChange(index, 'title1', e.target.value)}
                                placeholder="Primary title..."
                                className="w-full px-5 py-4 bg-[#16161F] border border-[#454964] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-[#FAC800]/20 focus:border-[#FAC800] transition-all text-white placeholder-[#646882]"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-wider text-[#646882]">Title 2</label>
                              <input
                                type="text"
                                value={item.title2}
                                onChange={(e) => handleNameTitleChange(index, 'title2', e.target.value)}
                                placeholder="Secondary title..."
                                className="w-full px-5 py-4 bg-[#16161F] border border-[#454964] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-[#FAC800]/20 focus:border-[#FAC800] transition-all text-white placeholder-[#646882]"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'keyword' && (
                    <div className={`grid gap-6 transition-all duration-300 ${data.keywords.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {data.keywords.map((keyword, index) => (
                        <div key={index} className="relative flex gap-4 items-start bg-[#1E1E2E] p-6 rounded-[5px] border border-[#32364E]">
                          <div className="flex-1 space-y-2">
                            <label className="text-xs font-bold uppercase tracking-wider text-[#646882]">Keyword {index + 1}</label>
                            <textarea
                              value={keyword}
                              onChange={(e) => handleKeywordChange(index, e.target.value)}
                              rows={2}
                              placeholder="Enter text"
                              className="w-full px-5 py-3 bg-[#16161F] border border-[#454964] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-[#FAC800]/20 focus:border-[#FAC800] transition-all resize-none text-sm text-white placeholder-[#646882]"
                            />
                          </div>
                          {data.keywords.length > 1 && (
                            <button
                              onClick={() => removeKeyword(index)}
                              className="p-3 bg-[#222330] border border-[#32364E] text-red-500 rounded-[5px] hover:bg-red-500/10 transition-all shadow-sm"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'image' && (
                    <div className={`grid gap-6 transition-all duration-300 ${data.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {data.images.map((item, index) => (
                        <div key={index} className="relative p-6 bg-[#1E1E2E] rounded-[5px] border border-[#32364E] space-y-6">
                          {data.images.length > 1 && (
                            <button
                              onClick={() => removeImageEntry(index)}
                              className="absolute -top-3 -right-3 p-2 bg-[#222330] border border-[#32364E] text-red-500 rounded-[5px] hover:bg-red-500/10 transition-all shadow-sm z-20"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-wider text-[#646882]">Aspect Ratio {index + 1} *</label>
                              <select
                                value={item.aspectRatio}
                                onChange={(e) => handleImageEntryChange(index, 'aspectRatio', e.target.value)}
                                required
                                className="w-full px-5 py-4 bg-[#16161F] border border-[#454964] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-[#FAC800]/20 focus:border-[#FAC800] transition-all appearance-none text-white"
                              >
                                <option value="" disabled className="text-[#646882]">Select Ratio</option>
                                <option value="Vertical">Vertical (9:16)</option>
                                <option value="Horizontal">Horizontal (16:9)</option>
                                <option value="Square">Square (1:1)</option>
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-wider text-[#646882]">Image Source</label>
                              <input
                                type="text"
                                value={item.source}
                                onChange={(e) => handleImageEntryChange(index, 'source', e.target.value)}
                                placeholder="e.g. Getty Images..."
                                className="w-full px-5 py-4 bg-[#16161F] border border-[#454964] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-[#FAC800]/20 focus:border-[#FAC800] transition-all text-white placeholder-[#646882]"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-wider text-[#646882]">Project Image</label>
                            <div className="relative group">
                              <input
                                type="file"
                                onChange={(e) => {
                                  if (e.target.files && e.target.files[0]) {
                                    handleImageFileChange(index, e.target.files[0]);
                                  }
                                }}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                              />
                              <div className="w-full py-12 border-2 border-dashed border-[#454964] rounded-[5px] flex flex-col items-center justify-center bg-[#16161F] group-hover:bg-[#1A1A24] transition-all">
                                <ImageIcon className="w-10 h-10 text-[#646882] mb-3 group-hover:text-[#FAC800] transition-colors" />
                                <p className="text-sm font-medium text-[#8F95B2]">
                                  {item.file ? item.file.name : 'Click or drag to upload image'}
                                </p>
                                <p className="text-[10px] text-[#646882] mt-1 uppercase font-bold tracking-widest">PNG, JPG up to 10MB</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>



        {/* Static Bottom Section */}
        <div className="absolute bottom-0 left-72 right-0 bg-[#222330] border-t border-[#32364E] p-8 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
          <div className="max-w-6xl mx-auto flex gap-4 items-end transition-all duration-300">
            <div className="flex-1 space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[#8F95B2]">Slug Name</label>
              <input
                type="text"
                name="slugName"
                value={data.slugName}
                onChange={handleInputChange}
                placeholder="e.g. news-header-v1"
                className="w-full px-5 py-4 bg-[#16161F] border border-[#454964] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-[#FAC800]/20 focus:border-[#FAC800] transition-all font-mono text-sm text-white placeholder-[#646882]"
              />
            </div>
            <div className="w-64 space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[#8F95B2]">Project Aspect Ratio</label>
              <select
                name="projectAspectRatio"
                value={data.projectAspectRatio}
                onChange={handleInputChange}
                className="w-full px-5 py-4 bg-[#16161F] border border-[#454964] rounded-[5px] focus:outline-none focus:ring-2 focus:ring-[#FAC800]/20 focus:border-[#FAC800] transition-all appearance-none text-sm text-white"
              >
                <option value="" disabled className="text-[#646882]">Select Ratio</option>
                <option value="Vertical">Vertical (9:16)</option>
                <option value="Horizontal">Horizontal (16:9)</option>
                <option value="Square">Square (1:1)</option>
              </select>
            </div>
            <button
              onClick={handleRender}
              disabled={isRendering}
              className={`px-10 py-4 rounded-[5px] font-bold text-sm flex items-center gap-3 transition-all shadow-lg shadow-black/20 h-[58px] ${isRendering
                  ? 'bg-[#32364E] text-[#646882] cursor-not-allowed'
                  : 'bg-[#fac800] text-black hover:bg-[#e5b600] active:scale-95'
                }`}
            >
              {isRendering ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {renderStatus || 'Rendering...'}
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Render
                </>
              )}
            </button>
          </div>
        </div>

      </main>
    </div>
  );
}
