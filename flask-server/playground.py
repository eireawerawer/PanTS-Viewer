import numpy as np
import nibabel as nib
import os

path = r"D:\source\repos\jhu\kin\PanTS\data\ImageTr\PanTS_00000001\ct.nii.gz"
dat = nib.load(path)
print(dat.affine)