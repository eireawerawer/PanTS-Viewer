import type { RenderingEngine } from '@cornerstonejs/core';
import type { IImageVolume } from '@cornerstonejs/core/dist/types/types';
import { Niivue } from '@niivue/niivue';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import NestedCheckBox from '../components/NestedCheckBox/NestedCheckBox';
import OpacitySlider from '../components/OpacitySlider/OpacitySlider';
import ReportScreen from '../components/ReportScreen/ReportScreen';
import WindowingSlider from '../components/WindowingSlider/WindowingSlider';
import { renderVisualization, setToolGroupOpacity, setVisibilities } from '../helpers/CornerstoneNifti';
import { create3DVolume, updateGeneralOpacity, updateVisibilities } from '../helpers/NiiVueNifti';
import { APP_CONSTANTS, segmentation_categories } from '../helpers/constants';
import { filenameToName } from '../helpers/utils';
import { type CheckBoxData, type LastClicked, type NColorMap } from '../types';
import './VisualizationPage.css';

function VisualizationPage() {
  // References and state
  const params = useParams();
  const pantsCase = params.caseId ?? '1';
  
  const axial_ref = useRef<HTMLDivElement>(null);
  const sagittal_ref = useRef<HTMLDivElement>(null);
  const coronal_ref = useRef<HTMLDivElement>(null);
  const render_ref = useRef<HTMLCanvasElement>(null);
  const cmapRef = useRef<NColorMap>(null);
  const TaskMenu_ref = useRef(null);
  const VisualizationContainer_ref = useRef(null);
  const segmentationRef = useRef<IImageVolume>(null);
//   const lastClickInfoRef = useRef(null);

//   const [sliceAxial, setSliceAxial] = useState(0);
//   const [sliceSagittal, setSliceSagittal] = useState(0);
//   const [sliceCoronal, setSliceCoronal] = useState(0);
  const [checkState, setCheckState] = useState<boolean[]>([true]);
  const [segmentationRepresentationUIDs, setSegmentationRepresentationUIDs] = useState<string[] | null>(null);
  const [NV, setNV] = useState<Niivue | undefined>();
  const [sessionKey, setSessionKey] = useState<string | undefined>(undefined);
  const [checkBoxData, setCheckBoxData] = useState<CheckBoxData[]>([]);
  const [opacityValue, setOpacityValue] = useState(APP_CONSTANTS.DEFAULT_SEGMENTATION_OPACITY * 100);
  const [windowWidth, setWindowWidth] = useState(400);
  const [windowCenter, setWindowCenter] = useState(50);
  const [renderingEngine, setRenderingEngine] = useState<RenderingEngine | null>(null);
  const [viewportIds, setViewportIds] = useState<string[]>([]);
  const [volumeId, setVolumeId] = useState<string | null>(null);
  const [showReportScreen, setShowReportScreen] = useState(false);
  const [_lastClicked, setLastClicked] = useState<LastClicked | null>(null);
  const [showTaskDetails, setShowTaskDetails] = useState(false);


  const navigate = useNavigate();
  const location = useLocation();


  // Load and render visualization on first render
  useEffect(() => {
    const setup = async () => {
      // const state = location.state;
      // if (!state) {
        // alert('No Nifti Files Uploaded!');
        // navigate('/');
        // return;
      // }

      


      const checkBoxData = segmentation_categories.map((filename, i) => ({
        label: filenameToName(filename),
        id: i + 1
      }));
      setCheckBoxData(checkBoxData);
      const initialState = [true];  // background 永远可见
      checkBoxData.forEach(item => {
        initialState[item.id] = true;
      });
      setCheckState(initialState);



      const result =
        await renderVisualization(axial_ref, sagittal_ref, coronal_ref, "2", pantsCase);

      if (!result) return;
      const { segmentationVolumeArray, segRepUIDs, renderingEngine, viewportIds, volumeId } = result;

      setSegmentationRepresentationUIDs(segRepUIDs);
      setRenderingEngine(renderingEngine);
      setViewportIds(viewportIds);
      setVolumeId(volumeId);

      const { nv, cmapCopy } = await create3DVolume(render_ref, pantsCase);
      cmapRef.current = cmapCopy;
      setNV(nv);
      segmentationRef.current = segmentationVolumeArray;
    };

    setup();
  }, [pantsCase]);
  // Toggle checkbox state
  const update = (id: number, checked: boolean) => {
    setCheckState(prev => ({
      ...prev,
      [id]: checked
    }));
  };
  

  // Update VOI (window/level) settings
  const handleWindowChange = (newWidth: number | null, newCenter: number | null) => {
    const _width = Math.max(newWidth ?? windowWidth, 1);
    const _center = newCenter ?? windowCenter;

    setWindowWidth(_width);
    setWindowCenter(_center);

    if (!renderingEngine || !viewportIds.length || !volumeId) return;

    const windowLow = _center - _width / 2;
    const windowHigh = _center + _width / 2;

    viewportIds.forEach((viewportId) => {
      const viewport = renderingEngine.getViewport(viewportId);
      const actors = viewport.getActors();

      for (const actor of actors) {
        if (actor.uid === volumeId) {
          try {
            const tf = actor.actor.getProperty().getRGBTransferFunction(0);
            tf.setMappingRange(windowLow, windowHigh);
            tf.updateRange();
            viewport.render();
          } catch (e) {
            console.warn("[VOI Error]", e);
          }
        }
      }
    });
  };


  // Apply window settings on change
  useEffect(() => {
    if (renderingEngine && viewportIds.length && volumeId) {
      handleWindowChange(windowWidth, windowCenter);
    }
  }, [renderingEngine, viewportIds, volumeId]);


  // Update segmentation visibility when state changes
  useEffect(() => {
    if (segmentationRepresentationUIDs && checkState && NV) {
      const checkStateArr = [
        true,  // ID=0 background 永远可见
        ...checkBoxData.map(item => !!checkState[item.id])
      ];
      console.log('150', checkStateArr);
      setVisibilities(segmentationRepresentationUIDs, checkStateArr);
      updateVisibilities(NV, checkStateArr, sessionKey, cmapRef.current);
    }
  }, [segmentationRepresentationUIDs, checkState, NV, checkBoxData, sessionKey]);
  



  const handleOpacityOnSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setOpacityValue(value);
    setToolGroupOpacity(value / 100);
    updateGeneralOpacity(render_ref, value / 100);
  };

  const handleOpacityOnFormSubmit = (value: number) => {
    setOpacityValue(value);
    setToolGroupOpacity(value / 100);
    updateGeneralOpacity(render_ref, value / 100);
  };

  const handleDownloadClick = async () => {
    const backendUrl = "https://localhost:5001";
    const response = await fetch(`${backendUrl}/api/download/${pantsCase}`);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${pantsCase}_segmentations.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const navBack = () => {
    const formData = new FormData();
    if (sessionKey) {
      formData.append('sessionKey', sessionKey);
      fetch(`${APP_CONSTANTS.API_ORIGIN}/api/terminate-session`, {
        method: 'POST',
        body: formData,
      }).then(res => res.json()).then(data => console.log(data.message));
    }
    navigate('/');
  };

  return (
    <div className="VisualizationPage" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <div className="sidebar">
          <div className="tasks-container">
            <div className="dropdown">
              {/* Toggle dropdown */}
              <div
                className="dropdown-header"
                onClick={() => setShowTaskDetails(prev => !prev)}
              >
                {showTaskDetails ? "Settings" : "Settings"}
              </div>
  
              {!showTaskDetails && (
                <>

  
                  {/* Opacity & Windowing Sliders */}
                  <OpacitySlider
                    opacityValue={opacityValue}
                    handleOpacityOnSliderChange={handleOpacityOnSliderChange}
                    handleOpacityOnFormSubmit={handleOpacityOnFormSubmit}
                  />
  
                  <WindowingSlider
                    windowWidth={windowWidth}
                    windowCenter={windowCenter}
                    onWindowChange={handleWindowChange}
                  />
  
                  {/* Report Download Buttons */}
                  <div className="report-container">
                    <button onClick={handleDownloadClick}>Download</button>
                    <button onClick={() => setShowReportScreen(prev => !prev)}>Report</button>
                  </div>
                </>
              )}
            </div>
          </div>
  
          <button onClick={navBack} className="back-button">Back</button>

        </div>
  
        <div
          className="visualization-container"
          ref={VisualizationContainer_ref}
          style={{ flexGrow: 1, position: 'relative', paddingBottom: '90px', overflow: 'hidden' }}
        >
          <div
            className="axial"
            ref={axial_ref}
            onMouseDown={(e) =>
              setLastClicked({
                orientation: 'axial',
                x: Math.floor(e.clientX - e.currentTarget.getBoundingClientRect().left),
                y: Math.floor(e.clientY - e.currentTarget.getBoundingClientRect().top),
              })
            }
          ></div>
  
          <div
            className="sagittal"
            ref={sagittal_ref}
            onMouseDown={(e) =>
              setLastClicked({
                orientation: 'sagittal',
                x: Math.floor(e.clientX - e.currentTarget.getBoundingClientRect().left),
                y: Math.floor(e.clientY - e.currentTarget.getBoundingClientRect().top),
              })
            }
          ></div>
  
          <div
            className="coronal"
            ref={coronal_ref}
            onMouseDown={(e) =>
              setLastClicked({
                orientation: 'coronal',
                x: Math.floor(e.clientX - e.currentTarget.getBoundingClientRect().left),
                y: Math.floor(e.clientY - e.currentTarget.getBoundingClientRect().top),
              })
            }
          ></div>
  
          <div className="render">
            <div className="canvas">
              <canvas ref={render_ref}></canvas>
            </div>
          </div>
        </div>
      </div>
  
      {/* Fixed bottom bar for organ selection */}
      <div className="checkbox-bottom-bar">
        <NestedCheckBox
          setCheckState={setCheckState}
          checkBoxData={checkBoxData}
          innerRef={TaskMenu_ref}
          checkState={checkState}
          update={update}
          sessionId={sessionKey}
          clabelId={pantsCase}
        />
      </div>

  
      {showReportScreen && (
        <ReportScreen sessionKey={sessionKey} onClose={() => setShowReportScreen(false)} />
      )}
    </div>
  );
  
}

export default VisualizationPage;

