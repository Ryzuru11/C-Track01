import axios from "axios";
import API_URL from "../config/api.config";

export const getComments = async (reportId: string) => {
  const res = await axios.get(`${API_URL}/comments/${reportId}`);
  return res.data;
};

export const sendComment = async (
  reportId: string,
  content: string,
  parentId: string | null,
  token: string
) => {
  const res = await axios.post(
    `${API_URL}/comments`,
    {
      reportId,
      content,
      parentId,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return res.data;
};