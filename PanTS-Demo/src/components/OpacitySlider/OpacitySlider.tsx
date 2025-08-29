import React, { useEffect, useState } from "react";
import './OpacitySlider.css';


type Props = {
  opacityValue: number;
  handleOpacityOnSliderChange: (value: React.ChangeEvent<HTMLInputElement>) => void;
  handleOpacityOnFormSubmit: (value: number) => void;
}
export default function OpacitySlider({
  opacityValue,
  handleOpacityOnSliderChange,
  handleOpacityOnFormSubmit
}: Props) {
  const [textValue, setTextValue] = useState(opacityValue);

  // Sync input field when external opacityValue changes
  useEffect(() => {
    setTextValue(opacityValue);
  }, [opacityValue]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTextValue(Number(e.target.value));
  };

  const handleOpacitySubmit = (e: React.ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    let v = Number(textValue);
    if (isNaN(v)) return;

    // Clamp value between 0 and 100
    v = Math.max(0, Math.min(100, v));
    setTextValue(v);
    handleOpacityOnFormSubmit(v);
  };

  const inputStyle = {
    backgroundColor: '#333',  // 深灰色背景
    color: 'white',           // 白色文字
    border: '1px solid #ccc', // 可选：浅灰色边框
    borderRadius: '4px',
    padding: '6px 10px',
    outline: 'none',
  };

  const formStyle = {
    display: "inline-block",
    marginLeft: "10px"
  };

  return (
    <div className="windowing-slider">
      <div>
        <label style={{ color: 'white' }}>Overall Label Opacity</label>
        <form onSubmit={handleOpacitySubmit} style={formStyle}>
          <input
            type="text"
            value={textValue}
            onChange={handleTextChange}
            style={inputStyle}
          />
        </form>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={opacityValue}
          onChange={handleOpacityOnSliderChange}
        />
      </div>
    </div>
  );
}
