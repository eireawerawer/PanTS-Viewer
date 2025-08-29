import { useEffect } from 'react';
import { APP_CONSTANTS } from '../../helpers/constants';

type Props = {
  sessionKey: string | undefined;
  onClose: () => void;
}
const ReportScreen = ({ sessionKey, onClose }: Props): React.ReactElement | null => {
  useEffect(() => {
    if (typeof sessionKey !== "undefined") {
      const formData = new FormData();
      formData.append("sessionKey", sessionKey);

      fetch(`${APP_CONSTANTS.API_ORIGIN}/api/get-report`, {
        method: "POST",
        body: formData,
      })
        .then(async (res) => {
          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to fetch report PDF: ${res.status} ${res.statusText} - ${errorText}`);
          }
          return res.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank", "noopener,noreferrer");
          onClose(); // Close the component after opening the PDF
        })
        .catch(() => {
          onClose(); // Also close on error
        });
    }
  }, [sessionKey, onClose]);

  return null; // Do not render anything
};

export default ReportScreen;
