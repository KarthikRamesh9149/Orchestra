import type { IconType } from "react-icons";
import {
  TbAlertCircle,
  TbArrowLeft,
  TbArrowRight,
  TbBell,
  TbBooks,
  TbBrain,
  TbCalendar,
  TbCheckbox,
  TbCheck,
  TbClock,
  TbCode,
  TbDownload,
  TbEdit,
  TbEye,
  TbFile,
  TbFileDescription,
  TbFileText,
  TbFolders,
  TbGitBranch,
  TbGitPullRequest,
  TbGripHorizontal,
  TbLayoutGrid,
  TbLock,
  TbLockOpen2,
  TbMaximize,
  TbMenu2,
  TbMessage2,
  TbMicrophone,
  TbPhoto,
  TbPlus,
  TbRefresh,
  TbSearch,
  TbSend2,
  TbSettings,
  TbSparkles,
  TbUpload,
  TbUser,
  TbUsers,
  TbX,
  TbZoomIn,
  TbZoomOut
} from "react-icons/tb";

export type IconProps = {
  className?: string;
  size?: number | string;
};

function createIcon(Icon: IconType) {
  return function WrappedIcon({ className = "h-5 w-5", size }: IconProps) {
    return <Icon className={className} size={size} strokeWidth={1.5} />;
  };
}

export const Grid2x2Icon = createIcon(TbLayoutGrid);
export const ArrowLeftIcon = createIcon(TbArrowLeft);
export const ArrowRightIcon = createIcon(TbArrowRight);
export const LayoutDashboardIcon = createIcon(TbLayoutGrid);
export const BrainIcon = createIcon(TbBrain);
export const SparklesIcon = createIcon(TbBrain);
export const SparklesNodeIcon = createIcon(TbSparkles);
export const FileTextIcon = createIcon(TbFileText);
export const FileDescriptionIcon = createIcon(TbFileDescription);
export const FoldersIcon = createIcon(TbFolders);
export const BookOpenIcon = createIcon(TbFileDescription);
export const BooksIcon = createIcon(TbBooks);
export const FileIcon = createIcon(TbFile);
export const MessageSquareIcon = createIcon(TbMessage2);
export const CodeIcon = createIcon(TbCode);
export const MicIcon = createIcon(TbMicrophone);
export const ImageIcon = createIcon(TbPhoto);
export const UploadCloudIcon = createIcon(TbUpload);
export const UploadIcon = createIcon(TbUpload);
export const RefreshIcon = createIcon(TbRefresh);
export const SearchIcon = createIcon(TbSearch);
export const SettingsIcon = createIcon(TbSettings);
export const UsersIcon = createIcon(TbUsers);
export const UserIcon = createIcon(TbUser);
export const GitBranchIcon = createIcon(TbGitBranch);
export const GitMergeIcon = createIcon(TbGitPullRequest);
export const GitPullRequestIcon = createIcon(TbGitPullRequest);
export const CheckSquareIcon = createIcon(TbCheckbox);
export const CheckboxIcon = createIcon(TbCheckbox);
export const CheckIcon = createIcon(TbCheck);
export const AlertCircleIcon = createIcon(TbAlertCircle);
export const CalendarIcon = createIcon(TbCalendar);
export const ClockIcon = createIcon(TbClock);
export const ZoomInIcon = createIcon(TbZoomIn);
export const ZoomOutIcon = createIcon(TbZoomOut);
export const MaximizeIcon = createIcon(TbMaximize);
export const LockIcon = createIcon(TbLock);
export const LockOpenIcon = createIcon(TbLockOpen2);
export const EditIcon = createIcon(TbEdit);
export const DownloadIcon = createIcon(TbDownload);
export const EyeIcon = createIcon(TbEye);
export const GripHorizontalIcon = createIcon(TbGripHorizontal);
export const SendIcon = createIcon(TbSend2);
export const PlusIcon = createIcon(TbPlus);
export const CloseIcon = createIcon(TbX);
export const BellIcon = createIcon(TbBell);
export const MenuIcon = createIcon(TbMenu2);
