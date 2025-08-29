import React from "react";

import { useState } from "react";

type Props = {
  windowWidth: number;
  windowCenter: number;
  onWindowChange: (width: number | null, center: number | null) => void;
}
export default function WindowingSlider({ windowWidth, windowCenter, onWindowChange }: Props) {
  const [widthInput, setWidthInput] = useState(windowWidth);
  const [centerInput, setCenterInput] = useState(windowCenter);

  const handleWidthInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWidthInput(Number( e.target.value));
  };

  const handleCenterInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCenterInput(Number(e.target.value));
  };

  const handleWidthSubmit = (e: React.ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    let v = widthInput;
    if (!isNaN(v)) {
      v = Math.min(Math.max(v, 1), 400);
      onWindowChange(v, null);
    }
  };

  const handleCenterSubmit = (e: React.ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    let v = centerInput;
    if (!isNaN(v)) {
      v = Math.min(Math.max(v, -1000), 50);
      onWindowChange(null, v);
    }
  };
  const inputStyle = {
    backgroundColor: '#333',  // 深灰色背景
    color: 'white',           // 白色文字
    border: '1px solid #ccc', // 可选：浅灰色边框
    borderRadius: '4px',
    padding: '6px 10px',
    outline: 'none',
  };
  return (
    <div className="windowing-slider">

      <div>
        <label style={{ color: 'white' }}>Level</label>

        <form onSubmit={handleCenterSubmit} style={{ display: 'inline-block', marginLeft: '10px' }}>
          <input
            type="text"
            value={centerInput}
            onChange={handleCenterInputChange}
            style={inputStyle}
          />
        </form>
        <input
          type="range"
          min="-1000"
          max="1000"
          step="1"
          value={windowCenter}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            setCenterInput(v);
            onWindowChange(null, v);
          }}
        />
      </div>
      <div>
        <label style={{ color: 'white' }}>Window</label>

        <form onSubmit={handleWidthSubmit} style={{ display: 'inline-block', marginLeft: '10px' }}>
          <input
            type="text"
            value={widthInput}
            onChange={handleWidthInputChange}
            style={inputStyle}
          />
        </form>
        <input
          type="range"
          min="1"
          max="2000"
          step="1"
          value={windowWidth}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            setWidthInput(v);
            onWindowChange(v, null);
          }}
        />
      </div>
    </div>
  );
}
