import { useParams, Navigate } from "react-router-dom";

// ProjectDetail is now embedded in the Dashboard sidebar layout.
// This route redirects to the dashboard for backward compatibility.
export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/?project=${id}`} replace />;
}
