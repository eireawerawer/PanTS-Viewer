import os
import uuid
import subprocess
import re
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def get_least_used_gpu(default_gpu=None):
    if default_gpu is None:
        try:
            available_gpus_str = os.getenv("AVAILABLE_GPUS", "")
            available_gpus = [int(x) for x in available_gpus_str.split(",") if x.strip().isdigit()]
            if not available_gpus:
                raise ValueError("No available GPUs specified.")

            result = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                universal_newlines=True
            )
            mem_usages = [int(x) for x in result.strip().split("\n")]
            least_used_gpu = min(available_gpus, key=lambda i: mem_usages[i])
            return str(least_used_gpu)
        except Exception as e:
            print("⚠️ Failed to get GPU info, defaulting to 0:", e)
            return "0"
    else:
        return str(default_gpu)


def run_auto_segmentation(input_path, session_dir, model):
    """
    Run auto segmentation model using Apptainer inside the given session directory.
    """
    subfolder_name = "ct"

    input_case_dir = os.path.join(session_dir, "inputs")
    outputs_root = os.path.join(session_dir, "outputs")
    input_case_ct_dir = os.path.join(input_case_dir, subfolder_name)
    os.makedirs(input_case_ct_dir, exist_ok=True)
    os.makedirs(outputs_root, exist_ok=True)

    input_filename = os.path.basename(input_path)
    container_input_path = os.path.join(input_case_ct_dir, input_filename)
    os.system(f"cp {input_path} {container_input_path}")

    conda_activate_cmd = ""

    conda_path = os.getenv("CONDA_ACTIVATE_PATH", "/opt/anaconda3/etc/profile.d/conda.sh")
    epai_env_name = os.getenv("CONDA_ENV_EPAI", "epai")
    suprem_sandbox_path = os.getenv("SUPREM_SANDBOX_PATH", "")
    epai_script_path = os.getenv("EPAI_SCRIPT_PATH", "")

    if model == 'SuPreM':
        container_path = suprem_sandbox_path
        print(input_case_dir, outputs_root)

        apptainer_cmd = [
            "apptainer", "run", "--nv",
            "-B", f"{input_case_dir}:/workspace/inputs",
            "-B", f"{outputs_root}:/workspace/outputs",
            container_path
        ]
    elif model == 'ePAI':
        conda_activate_cmd = f"source {conda_path} && conda activate {epai_env_name} &&"
        apptainer_cmd = ["bash", epai_script_path, session_dir]
    else:
        print(f"[ERROR] Unknown model: {model}")
        return None

    selected_gpu = get_least_used_gpu()
    apptainer_cmd = ["CUDA_VISIBLE_DEVICES=" + selected_gpu] + apptainer_cmd
    print(apptainer_cmd)
    try:
        print(f"[INFO] Running {model} auto segmentation for file: {input_filename}")
        full_cmd = f"{conda_activate_cmd} {' '.join(apptainer_cmd)}"
        subprocess.run(full_cmd, shell=True, executable="/bin/bash", check=True)
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] {model} inference failed:", e)
        return None

    if model == 'SuPreM':
        output_path = os.path.join(outputs_root, subfolder_name, "segmentations")
        if not os.path.exists(output_path):
            print("[ERROR] Output mask not found at:", output_path)
            return None
    elif model == 'ePAI':
        output_path = os.path.join(outputs_root, subfolder_name, "combined_labels.nii.gz")
        if not os.path.exists(output_path):
            print("[ERROR] Output mask not found at:", output_path)
            return None
        output_path = os.path.join(outputs_root, subfolder_name)

    return output_path
